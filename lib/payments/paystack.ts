/**
 * Paystack adapter (per-tenant).
 *
 * Collections: POST /transaction/initialize returns an authorization_url the
 * member opens to pay; the `charge.success` webhook reconciles the invoice.
 * Payouts: creates a transfer recipient then POST /transfer.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { CollectInput, CollectResult, PayoutInput, PayoutResult } from './types';

export interface PaystackCreds {
  secret_key: string;
  public_key?: string;
}

const API = 'https://api.paystack.co';

function headers(creds: PaystackCreds): Record<string, string> {
  return { Authorization: `Bearer ${creds.secret_key}`, 'Content-Type': 'application/json' };
}

async function psFetch(creds: PaystackCreds, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers(creds) });
  const data = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  };
  if (!res.ok || data.status !== true) {
    throw new Error(`Paystack ${path} failed: ${data.message ?? `HTTP ${res.status}`}`);
  }
  return (data.data ?? {}) as Record<string, unknown>;
}

/** Verify the `x-paystack-signature` webhook header (HMAC-SHA512 of raw body). */
export function verifyPaystackWebhook(secretKey: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const digest = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function paystackCollect(
  creds: PaystackCreds,
  input: CollectInput,
): Promise<CollectResult> {
  const { amountMinor, currency, accountRef, email, returnUrl } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('paystack: positive integer amountMinor required');
  if (!creds.secret_key) throw new Error('paystack: secret_key is not set');

  // Test vs live is determined by the key itself (sk_test vs sk_live).
  const reference = `welfare-${accountRef.slice(0, 8)}-${Date.now()}`;
  const data = await psFetch(creds, '/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountMinor, // Paystack expects the lowest denomination (kobo/pesewas/cents)
      currency,
      email: email ?? 'member@welfare.local',
      reference,
      callback_url: returnUrl,
      metadata: { invoice_id: accountRef },
    }),
  });
  const url = data.authorization_url as string | undefined;
  if (!url) throw new Error('Paystack initialize returned no authorization_url');
  return {
    channel: 'paystack_inline',
    providerRef: reference,
    nextAction: { kind: 'redirect', url, providerRef: reference },
  };
}

export async function paystackPayout(
  creds: PaystackCreds,
  input: PayoutInput,
): Promise<PayoutResult> {
  const { amountMinor, currency, phone, beneficiaryName, remarks } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('paystack: positive integer amountMinor required');
  if (!creds.secret_key) throw new Error('paystack: secret_key is not set');

  // Paystack transfers go to bank accounts or mobile-money wallets via a
  // transfer recipient. We treat `phone` as the mobile-money wallet number;
  // the org's currency determines the recipient type.
  const recipient = await psFetch(creds, '/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'mobile_money',
      name: (beneficiaryName ?? 'Beneficiary').slice(0, 100),
      account_number: (phone ?? '').replace(/\D/g, ''),
      bank_code: mobileMoneyBankCode(currency),
      currency,
    }),
  });
  const recipientCode = recipient.recipient_code as string | undefined;
  if (!recipientCode) throw new Error('Paystack transferrecipient returned no recipient_code');

  const data = await psFetch(creds, '/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: amountMinor,
      recipient: recipientCode,
      reason: remarks.slice(0, 100),
      reference: `welfare-po-${Date.now()}`,
    }),
  });
  const ref = (data.reference ?? data.transfer_code ?? '') as string;
  return { channel: 'paystack_transfer', providerRef: String(ref), settled: false };
}

/** Test the secret key by listing banks (cheap, read-only). */
export async function paystackTest(creds: PaystackCreds): Promise<string> {
  const res = await fetch(`${API}/bank?currency=NGN`, { headers: headers(creds) });
  const data = (await res.json().catch(() => ({}))) as { status?: boolean; data?: unknown[] };
  if (!res.ok || data.status !== true) throw new Error(`Paystack key check failed: HTTP ${res.status}`);
  return `Paystack key valid (banks lookup returned ${Array.isArray(data.data) ? data.data.length : 0}).`;
}

function mobileMoneyBankCode(currency: string): string {
  // Paystack mobile-money bank codes — verify against https://paystack.com/docs
  const map: Record<string, string> = { GHS: 'MTN', ZMW: 'MTN', KES: 'MPESA' };
  return map[currency] ?? 'MTN';
}
