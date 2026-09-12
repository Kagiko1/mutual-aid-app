/**
 * POST /api/payments/webhook/[processor]
 *
 * Generic collection webhook for per-tenant processors (flutterwave,
 * paystack, stripe). Daraja keeps its own /api/mpesa/* callback routes.
 *
 * Flow: parse event -> extract provider ref -> find the pending payment by
 * callback_payload.provider_ref -> load the org's processor credentials ->
 * verify the webhook signature -> reconcile via lib/payments/reconcile.
 *
 * Always answers 200 to well-formed provider events so providers stop
 * retrying; signature failures answer 401.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { decryptCredentials } from '@/lib/payments/crypto';
import { PROCESSORS, type ProcessorId } from '@/lib/payments/types';
import { verifyFlutterwaveWebhook } from '@/lib/payments/flutterwave';
import { verifyPaystackWebhook } from '@/lib/payments/paystack';
import { verifyStripeWebhook } from '@/lib/payments/stripe';
import { completeCollectionPayment, failCollectionPayment } from '@/lib/payments/reconcile';

interface ParsedEvent {
  providerRef: string;
  succeeded: boolean;
  receipt: string | null;
}

function parseEvent(processor: ProcessorId, body: Record<string, unknown>): ParsedEvent | null {
  if (processor === 'flutterwave') {
    const event = body.event as string | undefined;
    const data = (body.data ?? {}) as Record<string, unknown>;
    if (event === 'payment.completed' || (data.status as string) === 'successful') {
      return {
        providerRef: String(data.tx_ref ?? ''),
        succeeded: (data.status as string) === 'successful',
        receipt: (data.flw_ref as string | undefined) ?? null,
      };
    }
    return null;
  }
  if (processor === 'paystack') {
    const event = body.event as string | undefined;
    const data = (body.data ?? {}) as Record<string, unknown>;
    if (event === 'charge.success') {
      return {
        providerRef: String(data.reference ?? ''),
        succeeded: (data.status as string) === 'success',
        receipt: (data.reference as string | undefined) ?? null,
      };
    }
    return null;
  }
  if (processor === 'stripe') {
    const type = body.type as string | undefined;
    const obj = ((body.data ?? {}) as Record<string, unknown>).object as Record<string, unknown> | undefined;
    if (type === 'checkout.session.completed' && obj?.id) {
      return {
        providerRef: String(obj.id),
        succeeded: (obj.payment_status as string) === 'paid',
        receipt: (obj.payment_intent as string | undefined) ?? String(obj.id),
      };
    }
    if (type === 'checkout.session.expired' && obj?.id) {
      return { providerRef: String(obj.id), succeeded: false, receipt: null };
    }
    return null;
  }
  return null;
}

export async function POST(request: NextRequest, { params }: { params: { processor: string } }) {
  const admin = createAdminClient();
  const processor = params.processor as ProcessorId;
  if (!(PROCESSORS as readonly string[]).includes(processor) || processor === 'daraja') {
    return Response.json({ error: 'unknown processor' }, { status: 404 });
  }

  const rawBody = await request.text();
  const body = (JSON.parse(rawBody || '{}') ?? {}) as Record<string, unknown>;
  const parsed = parseEvent(processor, body);
  // Acknowledge uninteresting events so the provider stops retrying.
  if (!parsed || !parsed.providerRef) return Response.json({ received: true });

  const { data: payment } = await admin
    .from('payments')
    .select('*')
    .filter('callback_payload->>provider_ref', 'eq', parsed.providerRef)
    .maybeSingle();
  if (!payment) {
    console.warn(`[webhook:${processor}] no payment for ref=${parsed.providerRef}`);
    return Response.json({ received: true });
  }
  const orgId = (payment as { org_id: string }).org_id;

  // Load credentials for signature verification.
  const { data: cfg } = await admin
    .from('org_payment_processors')
    .select('credentials_cipher, is_active')
    .eq('org_id', orgId)
    .eq('processor', processor)
    .order('is_active', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cfg) {
    console.warn(`[webhook:${processor}] no processor config for org`);
    return Response.json({ received: true });
  }
  const creds = decryptCredentials(orgId, (cfg as { credentials_cipher: string }).credentials_cipher);

  let verified = false;
  let skippedVerification = false;
  if (processor === 'flutterwave') {
    if (creds.webhook_secret) {
      verified = verifyFlutterwaveWebhook(creds.webhook_secret, request.headers.get('verif-hash'));
    } else {
      // Flutterwave's verif-hash is optional; without a configured secret there
      // is nothing to check against. Accept but log loudly.
      skippedVerification = true;
      console.warn(`[webhook:${processor}] no webhook secret configured for org=${orgId}; accepting unverified event`);
    }
  } else if (processor === 'paystack') {
    verified = verifyPaystackWebhook(creds.secret_key, rawBody, request.headers.get('x-paystack-signature'));
  } else if (processor === 'stripe') {
    if (!creds.webhook_secret) {
      console.warn(`[webhook:${processor}] no webhook signing secret configured for org=${orgId}; add whsec_... in /admin/payments`);
      return Response.json({ error: 'webhook secret not configured' }, { status: 401 });
    }
    verified = verifyStripeWebhook(creds.webhook_secret, rawBody, request.headers.get('stripe-signature'));
  }
  if (!verified && !skippedVerification) {
    console.warn(`[webhook:${processor}] signature verification failed for org=${orgId}`);
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  try {
    if (parsed.succeeded && (payment as { status: string }).status !== 'completed') {
      await completeCollectionPayment(admin, payment as Record<string, unknown>, {
        receipt: parsed.receipt,
        orgId,
        currencyCode: (payment as { currency_code: string }).currency_code,
      });
    } else if (!parsed.succeeded) {
      await failCollectionPayment(admin, payment as Record<string, unknown>, `${processor} webhook: payment not successful`);
    }
  } catch (e) {
    console.error(`[webhook:${processor}] reconcile error:`, e);
  }
  return Response.json({ received: true });
}
