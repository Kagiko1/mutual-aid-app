/**
 * M-Pesa Daraja API client.
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

const BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  live: 'https://api.safaricom.co.ke',
};

function baseUrl(): string {
  const url = BASE_URLS[MPESA_MODE];
  if (!url) throw new Error(`Unknown MPESA_MODE: ${MPESA_MODE} (expected stub|sandbox|live)`);
  return url;
}

async function getAccessToken(): Promise<string> {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error('MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET are not set');
  }
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
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
function normalizePhone(phone: string): string {
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
export async function stkPush(input: StkPushInput): Promise<StkPushResult> {
  const { phone, amountMinor, accountRef, description } = input;
  if (!phone || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('stkPush: phone and a positive integer amountMinor are required');
  }

  if (isStub()) {
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

  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) throw new Error('MPESA_SHORTCODE / MPESA_PASSKEY are not set');
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const amount = Math.max(1, Math.round(amountMinor / 100));
  const msisdn = normalizePhone(phone);

  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: msisdn,
      PartyB: shortcode,
      PhoneNumber: msisdn,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
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
 * MPESA_SECURITY_CREDENTIAL must be the initiator password encrypted with
 * Safaricom's public certificate (see Daraja docs); it is passed through as-is.
 */
export async function b2cPayment(input: B2cInput): Promise<B2cResult> {
  const { phone, amountMinor, remarks } = input;
  if (!phone || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('b2cPayment: phone and a positive integer amountMinor are required');
  }

  if (isStub()) {
    const originatorConversationId = `stub_orig_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const conversationId = `stub_conv_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    console.log(
      `[mpesa stub] B2C phone=${phone} amountMinor=${amountMinor} remarks="${remarks}"`,
    );
    console.log(`[mpesa stub] -> originatorConversationId=${originatorConversationId}`);
    return { conversationId, originatorConversationId };
  }

  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const initiator = process.env.MPESA_INITIATOR_NAME;
  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL;
  if (!shortcode || !initiator || !securityCredential) {
    throw new Error('MPESA_SHORTCODE / MPESA_INITIATOR_NAME / MPESA_SECURITY_CREDENTIAL are not set');
  }
  const amount = Math.max(1, Math.round(amountMinor / 100));
  const msisdn = normalizePhone(phone);

  const res = await fetch(`${baseUrl()}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      InitiatorName: initiator,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayment',
      Amount: amount,
      PartyA: shortcode,
      PartyB: msisdn,
      Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
      ResultURL: process.env.MPESA_B2C_RESULT_URL,
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
