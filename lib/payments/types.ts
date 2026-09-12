/**
 * Payment processor framework types + registry metadata.
 *
 * Each tenant (organization) can connect one or more payment processors in
 * /admin/payments. Credentials are collected in the UI, encrypted with
 * lib/payments/crypto, and stored in org_payment_processors.
 */

export const PROCESSORS = ['daraja', 'flutterwave', 'paystack', 'stripe'] as const;
export type ProcessorId = (typeof PROCESSORS)[number];

export const PROCESSOR_ENVIRONMENTS = ['test', 'live'] as const;
export type ProcessorEnvironment = (typeof PROCESSOR_ENVIRONMENTS)[number];

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required: boolean;
  secret: boolean; // rendered as password input, masked after save
}

export interface ProcessorMeta {
  id: ProcessorId;
  name: string;
  tagline: string;
  regions: string;
  /** ISO currency codes this processor can move for this product. */
  currencies: string[];
  supportsCollections: boolean;
  supportsPayouts: boolean;
  fields: CredentialField[];
  testHint: string;
}

const DARAJA_FIELDS: CredentialField[] = [
  { key: 'consumer_key', label: 'Consumer key', required: true, secret: true, help: 'From your Daraja app (OAuth credentials).' },
  { key: 'consumer_secret', label: 'Consumer secret', required: true, secret: true },
  { key: 'shortcode', label: 'Business shortcode', required: true, secret: false, placeholder: '174379', help: 'Paybill or till number. Sandbox default: 174379.' },
  { key: 'passkey', label: 'Online passkey', required: true, secret: true, help: 'Lipa na M-Pesa Online passkey (STK push).' },
  { key: 'initiator_name', label: 'Initiator name', required: false, secret: false, help: 'B2C initiator username (needed for payouts).' },
  { key: 'security_credential', label: 'Security credential', required: false, secret: true, help: 'Initiator password encrypted with Safaricom’s public certificate (needed for payouts).' },
];

const FLUTTERWAVE_FIELDS: CredentialField[] = [
  { key: 'secret_key', label: 'Secret key', required: true, secret: true, placeholder: 'FLWSECK_TEST-...', help: 'Starts with FLWSECK_TEST or FLWSECK-.' },
  { key: 'public_key', label: 'Public key', required: false, secret: false, placeholder: 'FLWPUBK_TEST-...' },
  { key: 'webhook_secret', label: 'Webhook secret hash', required: false, secret: true, help: 'Set the same value in your Flutterwave dashboard webhooks; used to verify callbacks.' },
];

const PAYSTACK_FIELDS: CredentialField[] = [
  { key: 'secret_key', label: 'Secret key', required: true, secret: true, placeholder: 'sk_test_...' },
  { key: 'public_key', label: 'Public key', required: false, secret: false, placeholder: 'pk_test_...' },
];

const STRIPE_FIELDS: CredentialField[] = [
  { key: 'secret_key', label: 'Secret key', required: true, secret: true, placeholder: 'sk_test_...' },
  { key: 'publishable_key', label: 'Publishable key', required: false, secret: false, placeholder: 'pk_test_...' },
  { key: 'webhook_secret', label: 'Webhook signing secret', required: false, secret: true, placeholder: 'whsec_...', help: 'From the webhook endpoint you create in the Stripe dashboard.' },
];

export const PROCESSOR_META: Record<ProcessorId, ProcessorMeta> = {
  daraja: {
    id: 'daraja',
    name: 'M-Pesa (Daraja)',
    tagline: 'Safaricom M-Pesa via the Daraja API — STK push collections and B2C payouts.',
    regions: 'Kenya · Tanzania',
    currencies: ['KES'],
    supportsCollections: true,
    supportsPayouts: true,
    fields: DARAJA_FIELDS,
    testHint: 'Fetches a Daraja OAuth access token to verify the consumer key/secret.',
  },
  flutterwave: {
    id: 'flutterwave',
    name: 'Flutterwave',
    tagline: 'Cards, mobile money and bank transfers across Africa — payment links and transfers.',
    regions: 'Pan-African + international',
    currencies: ['KES', 'UGX', 'TZS', 'RWF', 'NGN', 'GHS', 'ZMW', 'ZAR', 'USD', 'EUR', 'GBP'],
    supportsCollections: true,
    supportsPayouts: true,
    fields: FLUTTERWAVE_FIELDS,
    testHint: 'Lists your Flutterwave banks to verify the secret key.',
  },
  paystack: {
    id: 'paystack',
    name: 'Paystack',
    tagline: 'Cards, bank and mobile-money collections plus transfers to recipients.',
    regions: 'Nigeria · Ghana · South Africa · Kenya',
    currencies: ['NGN', 'GHS', 'ZAR', 'KES'],
    supportsCollections: true,
    supportsPayouts: true,
    fields: PAYSTACK_FIELDS,
    testHint: 'Lists your Paystack banks to verify the secret key.',
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    tagline: 'Global card payments via PaymentIntents. Collections only.',
    regions: 'Worldwide',
    currencies: ['USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'GHS'],
    supportsCollections: true,
    supportsPayouts: false,
    fields: STRIPE_FIELDS,
    testHint: 'Retrieves your Stripe account to verify the secret key.',
  },
};

export function getProcessorMeta(id: string): ProcessorMeta {
  const meta = (PROCESSOR_META as Record<string, ProcessorMeta>)[id];
  if (!meta) throw new Error(`unknown payment processor: ${id}`);
  return meta;
}

/** Validate raw credential input against the processor's field schema. */
export function validateCredentials(processor: ProcessorId, input: Record<string, unknown>): Record<string, string> {
  const meta = getProcessorMeta(processor);
  const out: Record<string, string> = {};
  for (const field of meta.fields) {
    const raw = input[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !value) {
      throw new Error(`"${field.label}" is required`);
    }
    if (value) {
      if (value.length > 2000) throw new Error(`"${field.label}" is too long`);
      out[field.key] = value;
    }
  }
  return out;
}

// ---------- collection / payout operation types ----------

export interface CollectInput {
  amountMinor: number;
  currency: string;
  phone?: string;
  email?: string;
  memberName?: string;
  accountRef: string; // invoice id — echoed back by the provider
  description: string;
  /** Where the member lands after paying (payment-link processors). */
  returnUrl?: string;
}

export type CollectNextAction =
  | { kind: 'stk_sent'; providerRef: string; detail: string }
  | { kind: 'redirect'; url: string; providerRef: string }
  | { kind: 'client_secret'; clientSecret: string; providerRef: string };

export interface CollectResult {
  nextAction: CollectNextAction;
  channel: string; // payments.channel value, e.g. 'mpesa_stk'
  providerRef: string; // stored in callback_payload for webhook reconciliation
}

export interface PayoutInput {
  amountMinor: number;
  currency: string;
  phone?: string;
  beneficiaryName?: string;
  remarks: string;
}

export interface PayoutResult {
  providerRef: string; // stored as mpesa_receipt / reconciled later
  channel: string; // disbursements.channel value
  settled: boolean; // true when the provider confirms synchronously (stub)
}

// ---------- saved row shape ----------

export interface ProcessorRow {
  id: string;
  org_id: string;
  processor: ProcessorId;
  environment: ProcessorEnvironment;
  purpose: 'collections' | 'payouts' | 'both';
  is_active: boolean;
  credentials_hint: Record<string, string> | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  created_at: string;
  updated_at: string;
}
