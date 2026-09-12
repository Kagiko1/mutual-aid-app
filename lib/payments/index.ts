/**
 * Payment dispatcher — resolves the active processor for an org and routes
 * collections / payouts to it.
 *
 * Resolution order for each purpose:
 *   1. org_payment_processors row with is_active=true covering the purpose
 *      ('both' or the specific purpose).
 *   2. Legacy fallback: Daraja stub driven by MPESA_* env / MPESA_MODE
 *      (preserves existing behavior when no processor is configured).
 *
 * The dispatcher's collect()/payout() never throw for "no processor":
 * they fall back to stub. Callers that need a real processor (e.g. the
 * admin test button) use testConnection() instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptCredentials } from './crypto';
import {
  getProcessorMeta,
  type CollectInput,
  type CollectResult,
  type PayoutInput,
  type PayoutResult,
  type ProcessorId,
  type ProcessorEnvironment,
  type ProcessorRow,
} from './types';
import { stkPush, b2cPayment, type DarajaCreds } from '../mpesa';
import { flutterwaveCollect, flutterwavePayout, flutterwaveTest } from './flutterwave';
import { paystackCollect, paystackPayout, paystackTest } from './paystack';
import { stripeCollect, stripePayout, stripeTest } from './stripe';

export type ProcessorPurpose = 'collections' | 'payouts';

export interface ResolvedProcessor {
  row: ProcessorRow | null; // null => legacy stub fallback
  processor: ProcessorId;
  environment: ProcessorEnvironment;
  creds: Record<string, string>;
  collect(input: CollectInput): Promise<CollectResult>;
  payout(input: PayoutInput): Promise<PayoutResult>;
  /** True when money actually moves (not stub). */
  live: boolean;
}

/** Load the org's active processor row for a purpose, if any. */
export async function getActiveProcessorRow(
  admin: SupabaseClient,
  orgId: string,
  purpose: ProcessorPurpose,
): Promise<ProcessorRow | null> {
  const { data } = await admin
    .from('org_payment_processors')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .in('purpose', ['both', purpose])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ProcessorRow | null) ?? null;
}

export async function resolveProcessor(
  admin: SupabaseClient,
  orgId: string,
  purpose: ProcessorPurpose,
  currency: string,
): Promise<ResolvedProcessor> {
  const row = await getActiveProcessorRow(admin, orgId, purpose);

  if (!row) {
    // Legacy fallback: Daraja stub (env-driven). Only valid for KES.
    if (currency !== 'KES' && (process.env.MPESA_MODE ?? 'stub') !== 'stub') {
      throw new Error('mpesa_kes_only: no payment processor configured for ' + currency);
    }
    const test = true;
    return {
      row: null,
      processor: 'daraja',
      environment: 'test',
      creds: {},
      live: false,
      collect: async (input: CollectInput): Promise<CollectResult> => {
        if (!input.phone) throw new Error('phone is required for M-Pesa STK push');
        const r = await stkPush(
          { phone: input.phone, amountMinor: input.amountMinor, accountRef: input.accountRef, description: input.description },
          undefined,
        );
        return {
          channel: 'mpesa_stk',
          providerRef: r.checkoutRequestId,
          nextAction: { kind: 'stk_sent', providerRef: r.checkoutRequestId, detail: 'STK push sent. Enter your M-Pesa PIN on your phone.' },
        };
      },
      payout: async (input: PayoutInput): Promise<PayoutResult> => {
        if (!input.phone) throw new Error('phone is required for M-Pesa B2C payout');
        const r = await b2cPayment({ phone: input.phone, amountMinor: input.amountMinor, remarks: input.remarks }, undefined);
        return { channel: 'mpesa_b2c', providerRef: r.originatorConversationId, settled: test };
      },
    };
  }

  const meta = getProcessorMeta(row.processor);
  if (!meta.currencies.includes(currency)) {
    throw new Error(`processor_currency_unsupported: ${meta.name} does not support ${currency}`);
  }
  const creds = decryptCredentials(orgId, (await getCipher(admin, row.id)) as string);
  const env = row.environment;
  // Daraja test env hits Safaricom sandbox (async callbacks); live is async too.
  // Only the legacy no-config stub settles synchronously.
  const live = env === 'live';

  const collect = async (input: CollectInput): Promise<CollectResult> => {
    const tagged = { ...input, currency };
    switch (row.processor) {
      case 'daraja': {
        if (!input.phone) throw new Error('phone is required for M-Pesa STK push');
        const dc: DarajaCreds = { ...creds, environment: env };
        const r = await stkPush(
          { phone: input.phone, amountMinor: input.amountMinor, accountRef: input.accountRef, description: input.description },
          dc,
        );
        return {
          channel: 'mpesa_stk',
          providerRef: r.checkoutRequestId,
          nextAction: { kind: 'stk_sent', providerRef: r.checkoutRequestId, detail: 'STK push sent. Enter your M-Pesa PIN on your phone.' },
        };
      }
      case 'flutterwave':
        return flutterwaveCollect({ secret_key: creds.secret_key, public_key: creds.public_key, webhook_secret: creds.webhook_secret }, tagged);
      case 'paystack':
        return paystackCollect({ secret_key: creds.secret_key, public_key: creds.public_key }, tagged);
      case 'stripe':
        return stripeCollect({ secret_key: creds.secret_key, publishable_key: creds.publishable_key, webhook_secret: creds.webhook_secret }, tagged);
    }
  };

  const payout = async (input: PayoutInput): Promise<PayoutResult> => {
    const tagged = { ...input, currency };
    switch (row.processor) {
      case 'daraja': {
        if (!input.phone) throw new Error('phone is required for M-Pesa B2C payout');
        const dc: DarajaCreds = { ...creds, environment: env };
        const r = await b2cPayment({ phone: input.phone, amountMinor: input.amountMinor, remarks: input.remarks }, dc);
        // Daraja B2C is always async (result/timeout callbacks); never settled inline.
        return { channel: 'mpesa_b2c', providerRef: r.originatorConversationId, settled: false };
      }
      case 'flutterwave':
        return flutterwavePayout({ secret_key: creds.secret_key, webhook_secret: creds.webhook_secret }, tagged);
      case 'paystack':
        return paystackPayout({ secret_key: creds.secret_key }, tagged);
      case 'stripe':
        return stripePayout({ secret_key: creds.secret_key }, tagged);
    }
  };

  return { row, processor: row.processor, environment: env, creds, collect, payout, live };
}

async function getCipher(admin: SupabaseClient, rowId: string): Promise<string> {
  const { data, error } = await admin
    .from('org_payment_processors')
    .select('credentials_cipher')
    .eq('id', rowId)
    .single();
  if (error || !data) throw new Error('processor credentials not found');
  return (data as { credentials_cipher: string }).credentials_cipher;
}

/** Test raw (unsaved) credentials — used by the admin "Test connection" button. */
export async function testConnection(
  processor: ProcessorId,
  environment: ProcessorEnvironment,
  creds: Record<string, string>,
): Promise<string> {
  void environment;
  switch (processor) {
    case 'daraja': {
      // Cheapest Daraja check: OAuth token endpoint (no money movement).
      const key = creds.consumer_key;
      const secret = creds.consumer_secret;
      if (!key || !secret) throw new Error('consumer_key / consumer_secret are required');
      const base = environment === 'live' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
      const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
      });
      if (!res.ok) throw new Error(`Daraja OAuth failed: HTTP ${res.status} — check consumer key/secret`);
      return 'Daraja credentials valid (OAuth token issued).';
    }
    case 'flutterwave':
      return flutterwaveTest({ secret_key: creds.secret_key });
    case 'paystack':
      return paystackTest({ secret_key: creds.secret_key });
    case 'stripe':
      return stripeTest({ secret_key: creds.secret_key });
  }
}
