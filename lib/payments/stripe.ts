/**
 * Stripe adapter (per-tenant). Collections only — payouts are not supported
 * (use another processor for disbursements).
 *
 * Collections: creates a Checkout Session and returns its hosted URL; the
 * member pays on Stripe's page and the `checkout.session.completed` webhook
 * reconciles the invoice. No Stripe.js needed on the frontend.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { CollectInput, CollectResult, PayoutInput, PayoutResult } from './types';

export interface StripeCreds {
  secret_key: string;
  publishable_key?: string;
  webhook_secret?: string;
}

const API = 'https://api.stripe.com/v1';

function headers(creds: StripeCreds): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.secret_key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

async function stripeFetch(creds: StripeCreds, path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: headers(creds), body });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    id?: string;
    client_secret?: string;
  };
  if (!res.ok || data.error) {
    throw new Error(`Stripe ${path} failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
  }
  return data;
}

/**
 * Verify a Stripe webhook signature (`stripe-signature` header).
 * Format: t=<timestamp>,v1=<hmac>. Rejects timestamps older than 5 minutes.
 */
export function verifyStripeWebhook(webhookSecret: string | undefined, rawBody: string, signature: string | null): boolean {
  if (!webhookSecret || !signature) return false;
  const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

export async function stripeCollect(
  creds: StripeCreds,
  input: CollectInput,
): Promise<CollectResult> {
  const { amountMinor, currency, accountRef, description, email, returnUrl } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('stripe: positive integer amountMinor required');
  if (!creds.secret_key) throw new Error('stripe: secret_key is not set');

  // Test vs live is determined by the key itself (sk_test vs sk_live).
  const data = (await stripeFetch(creds, '/checkout/sessions', {
    mode: 'payment',
    success_url: returnUrl ?? '',
    cancel_url: returnUrl ?? '',
    customer_email: email ?? '',
    'line_items[0][price_data][currency]': currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amountMinor),
    'line_items[0][price_data][product_data][name]': description.slice(0, 200),
    'line_items[0][quantity]': '1',
    'metadata[invoice_id]': accountRef,
  })) as { id?: string; url?: string };
  if (!data.id || !data.url) throw new Error('Stripe checkout session returned no id/url');
  return {
    channel: 'stripe_checkout',
    providerRef: data.id,
    nextAction: { kind: 'redirect', url: data.url, providerRef: data.id },
  };
}

export async function stripePayout(_creds: StripeCreds, _input: PayoutInput): Promise<PayoutResult> {
  throw new Error('stripe_payouts_unsupported: Stripe is collections-only; connect another processor for disbursements');
}

/** Test the secret key by retrieving the account (cheap, read-only). */
export async function stripeTest(creds: StripeCreds): Promise<string> {
  const res = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${creds.secret_key}` } });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; id?: string; email?: string };
  if (!res.ok || data.error) throw new Error(`Stripe key check failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
  return `Stripe key valid (account ${data.id ?? data.email ?? 'ok'}).`;
}
