/**
 * Flutterwave adapter (per-tenant).
 *
 * Collections: creates a Flutterwave payment link (v3/payment-links) in the
 * org's currency; the member completes payment in their browser and the
 * `payment.completed` webhook reconciles the invoice.
 * Payouts: v3/transfers to mobile money / bank.
 */
import type { CollectInput, CollectResult, PayoutInput, PayoutResult } from './types';

export interface FlutterwaveCreds {
  secret_key: string;
  public_key?: string;
  webhook_secret?: string;
}

const API = 'https://api.flutterwave.com/v3';

function headers(creds: FlutterwaveCreds): Record<string, string> {
  return { Authorization: `Bearer ${creds.secret_key}`, 'Content-Type': 'application/json' };
}

async function fwFetch(creds: FlutterwaveCreds, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers(creds) });
  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    data?: Record<string, unknown>;
  };
  if (!res.ok || data.status !== 'success') {
    throw new Error(`Flutterwave ${path} failed: ${data.message ?? `HTTP ${res.status}`}`);
  }
  return (data.data ?? {}) as Record<string, unknown>;
}

/** Verify the `verif-hash` webhook header against the stored secret. */
export function verifyFlutterwaveWebhook(webhookSecret: string | undefined, verifHash: string | null): boolean {
  if (!webhookSecret) return false; // refuse unsigned webhooks when a secret is configured
  return verifHash === webhookSecret;
}

function toMajor(amountMinor: number, currency: string): number {
  // Zero-decimal currencies on Flutterwave: none of our 11 are zero-decimal
  // (NGN/GHS/ZAR use kobo/pesewas/cents). Keep minor/100 universally.
  void currency;
  return amountMinor / 100;
}

export async function flutterwaveCollect(
  creds: FlutterwaveCreds,
  input: CollectInput,
): Promise<CollectResult> {
  const { amountMinor, currency, accountRef, description, email, memberName, returnUrl } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('flutterwave: positive integer amountMinor required');
  if (!creds.secret_key) throw new Error('flutterwave: secret_key is not set');

  // Test vs live is determined by the key itself (FLWSECK_TEST vs FLWSECK-).
  const txRef = `welfare-${accountRef.slice(0, 8)}-${Date.now()}`;
  const data = await fwFetch(creds, '/payment-links', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: txRef,
      amount: toMajor(amountMinor, currency),
      currency,
      redirect_url: returnUrl,
      customer: { email: email ?? 'member@welfare.local', name: memberName ?? 'Welfare member' },
      customizations: { title: 'Welfare contribution', description: description.slice(0, 140) },
      meta: { invoice_id: accountRef },
    }),
  });
  const link = data.link as string | undefined;
  if (!link) throw new Error('Flutterwave payment link creation returned no link');
  return {
    channel: 'flutterwave_link',
    providerRef: txRef,
    nextAction: { kind: 'redirect', url: link, providerRef: txRef },
  };
}

export async function flutterwavePayout(
  creds: FlutterwaveCreds,
  input: PayoutInput,
): Promise<PayoutResult> {
  const { amountMinor, currency, phone, beneficiaryName, remarks } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('flutterwave: positive integer amountMinor required');
  if (!creds.secret_key) throw new Error('flutterwave: secret_key is not set');

  // Mobile-money transfer: account_number is the MSISDN, account_bank is the
  // network code. Beneficiary phone must be in international format.
  const msisdn = (phone ?? '').replace(/\D/g, '');
  if (!msisdn) throw new Error('flutterwave: beneficiary phone is required for mobile-money payout');
  const data = await fwFetch(creds, '/transfers', {
    method: 'POST',
    body: JSON.stringify({
      account_bank: mobileMoneyBankCode(currency),
      account_number: msisdn,
      amount: toMajor(amountMinor, currency),
      currency,
      narration: remarks.slice(0, 100),
      reference: `welfare-po-${Date.now()}`,
      beneficiary_name: beneficiaryName?.slice(0, 100),
    }),
  });
  const ref = (data.reference ?? data.id ?? '') as string;
  return { channel: 'flutterwave_transfer', providerRef: String(ref), settled: false };
}

/** Test the secret key by listing banks (cheap, read-only). */
export async function flutterwaveTest(creds: FlutterwaveCreds): Promise<string> {
  const data = await fwFetch(creds, '/banks/NG');
  const count = Array.isArray(data) ? data.length : 'ok';
  return `Flutterwave key valid (banks lookup returned ${count}).`;
}

/** Mobile-money network codes per currency (Flutterwave transfer codes). */
function mobileMoneyBankCode(currency: string): string {
  const map: Record<string, string> = {
    KES: 'MPS', // M-Pesa Kenya
    UGX: 'MPS', // MTN/Airtel Uganda via mobile-money rails
    TZS: 'MPS',
    RWF: 'MPS',
    GHS: 'MTN', // MTN MoMo Ghana
    ZMW: 'MTN',
    ZAR: 'ABSA', // ZAR has no mobile money; falls back to bank placeholder
  };
  return map[currency] ?? 'MPS';
}
