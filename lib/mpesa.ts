/**
 * M-Pesa Daraja API client (per-tenant capable).
 *
 * Credentials can be supplied per organization (from org_payment_processors);
 * when omitted, the legacy MPESA_* environment variables are used.
 *
 * MPESA_MODE controls behavior:
 *   'stub'    (default) — no network calls; logs and returns fake IDs.
 *   'sandbox'           — real Daraja sandbox endpoints.
 *   'live'              — real Daraja production endpoints.
 *
 * Money is passed in MINOR units; Daraja expects whole major units
 * (KES has no subunit on M-Pesa), so amounts are rounded to the nearest
 * major unit before sending.
 */
import { randomUUID } from 'crypto';

export const MPESA_MODE = process.env.MPESA_MODE ?? 'stub';

export function isStub(): boolean {
  return MPESA_MODE === 'stub';
}

export interface DarajaCreds {
  consumer_key?: string;
  consumer_secret?: string;
  shortcode?: string;
  passkey?: string;
  initiator_name?: string;
  security_credential?: string;
  /** Explicit callback URLs (override MPESA_* env). */
  callback_url?: string;
  b2c_result_url?: string;
  b2c_timeout_url?: string;
  /** 'sandbox' | 'live' — overrides MPESA_MODE when set. */
  environment?: string;
}

function envCreds(): DarajaCreds {
  return {
    consumer_key: process.env.MPESA_CONSUMER_KEY,
    consumer_secret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    initiator_name: process.env.MPESA_INITIATOR_NAME,
    security_credential: process.env.MPESA_SECURITY_CREDENTIAL,
    callback_url: process.env.MPESA_CALLBACK_URL,
    b2c_result_url: process.env.MPESA_B2C_RESULT_URL,
    b2c_timeout_url: process.env.MPESA_B2C_TIMEOUT_URL,
  };
}

function resolveCreds(overrides?: DarajaCreds): Required<DarajaCreds> {
  const merged = { ...envCreds(), ...(overrides ?? {}) };
  const missing = ['consumer_key', 'consumer_secret'].filter((k) => !merged[k as keyof DarajaCreds]);
  if (missing.length) {
    throw new Error(`Daraja credentials incomplete: missing ${missing.join(', ')}`);
  }
  return merged as Required<DarajaCreds>;
}

/** Org-level 'test' maps to Daraja sandbox; unset falls back to MPESA_MODE. */
export function effectiveMode(creds?: DarajaCreds): string {
  if (creds?.environment === 'live') return 'live';
  if (creds?.environment === 'test') return 'sandbox';
  return MPESA_MODE;
}

const BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  live: 'https://api.safaricom.co.ke',
};

function baseUrl(creds: DarajaCreds | undefined): string {
  const mode = effectiveMode(creds);
  const url = BASE_URLS[mode];
  if (!url) throw new Error(`Unknown Daraja mode: ${mode} (expected stub|sandbox|live)`);
  return url;
}

async function getAccessToken(creds: DarajaCreds | undefined): Promise<string> {
  const c = resolveCreds(creds);
  creds = creds ?? {};
  const res = await fetch(`${baseUrl(creds)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.consumer_key}:${c.consumer_secret}`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Daraja OAuth returned no access_token');
  return data.access_token;
}

/** Daraja timestamp format: yyyyMMddHHmmss */
function darajaTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Normalize a Kenyan phone number to Safaricom MSISDN form (2547XXXXXXXX). */
export function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (/^254\d{9}$/.test(p)) return p;
  throw new Error(`Invalid Kenyan phone number: ${phone}`);
}

export interface StkPushInput {
  phone: string;
  amountMinor: number;
  accountRef: string;
  description: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
}

/** C2B STK push — prompts the member's phone to pay. Reconciled via /api/mpesa/callback. */
export async function stkPush(input: StkPushInput, creds?: DarajaCreds): Promise<StkPushResult> {
  const { phone, amountMinor, accountRef, description } = input;
  if (!phone || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('stkPush: phone and a positive integer amountMinor are required');
  }

  if (effectiveMode(creds) === 'stub') {
    const checkoutRequestId = `ws_CO_stub_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const merchantRequestId = `stub_merch_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    console.log(
      `[mpesa stub] STK push phone=${phone} amountMinor=${amountMinor} accountRef=${accountRef} desc="${description}"`,
    );
    console.log(`[mpesa stub] -> checkoutRequestId=${checkoutRequestId}`);
    console.log(
      '[mpesa stub] NOTE: stub mode performs no network call and sends no async callback; ' +
        'payments stay pending until reconciled manually or via the callback route.',
    );
    return { checkoutRequestId, merchantRequestId };
  }

  const c = resolveCreds(creds);
  const token = await getAccessToken(creds);
  if (!c.shortcode || !c.passkey) throw new Error('Daraja shortcode / passkey are not set');
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString('base64');
  const amount = Math.max(1, Math.round(amountMinor / 100));
  const msisdn = normalizePhone(phone);

  const res = await fetch(`${baseUrl(creds)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: c.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: msisdn,
      PartyB: c.shortcode,
      PhoneNumber: msisdn,
      CallBackURL:
        c.callback_url ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/mpesa/callback`,
      AccountReference: accountRef.slice(0, 20),
      TransactionDesc: description.slice(0, 100),
    }),
  });
  const data = (await res.json()) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
  };
  if (!res.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID) {
    throw new Error(`STK push failed: ${data.ResponseDescription ?? `HTTP ${res.status}`}`);
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID ?? '',
  };
}

export interface B2cInput {
  phone: string;
  amountMinor: number;
  remarks: string;
}

export interface B2cResult {
  conversationId: string;
  originatorConversationId: string;
}

/**
 * B2C payment — pays out from the business shortcode to a phone.
 * security_credential must be the initiator password encrypted with
 * Safaricom's public certificate (see Daraja docs); it is passed through as-is.
 */
export async function b2cPayment(input: B2cInput, creds?: DarajaCreds): Promise<B2cResult> {
  const { phone, amountMinor, remarks } = input;
  if (!phone || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('b2cPayment: phone and a positive integer amountMinor are required');
  }

  if (effectiveMode(creds) === 'stub') {
    const originatorConversationId = `stub_orig_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const conversationId = `stub_conv_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    console.log(
      `[mpesa stub] B2C phone=${phone} amountMinor=${amountMinor} remarks="${remarks}"`,
    );
    console.log(`[mpesa stub] -> originatorConversationId=${originatorConversationId}`);
    return { conversationId, originatorConversationId };
  }

  const c = resolveCreds(creds);
  const token = await getAccessToken(creds);
  if (!c.shortcode || !c.initiator_name || !c.security_credential) {
    throw new Error('Daraja shortcode / initiator_name / security_credential are not set');
  }
  const amount = Math.max(1, Math.round(amountMinor / 100));
  const msisdn = normalizePhone(phone);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const res = await fetch(`${baseUrl(creds)}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      InitiatorName: c.initiator_name,
      SecurityCredential: c.security_credential,
      CommandID: 'BusinessPayment',
      Amount: amount,
      PartyA: c.shortcode,
      PartyB: msisdn,
      Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: c.b2c_timeout_url ?? `${appUrl}/api/mpesa/b2c-callback`,
      ResultURL: c.b2c_result_url ?? `${appUrl}/api/mpesa/b2c-callback`,
      Occasion: remarks.slice(0, 100),
    }),
  });
  const data = (await res.json()) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    ConversationID?: string;
    OriginatorConversationID?: string;
  };
  if (!res.ok || !data.OriginatorConversationID) {
    throw new Error(`B2C payment failed: ${data.ResponseDescription ?? `HTTP ${res.status}`}`);
  }
  return {
    conversationId: data.ConversationID ?? '',
    originatorConversationId: data.OriginatorConversationID,
  };
}
