/**
 * POST /api/mpesa/stk-push
 * Body: { invoiceId, phone?, email? }
 *
 * Member-initiated collection for one of their pending/overdue invoices.
 * Routes through the org's active payment processor (see /admin/payments):
 *   - M-Pesa Daraja: STK push to the phone (existing behavior).
 *   - Flutterwave / Paystack: returns an authorizationUrl for the member to
 *     complete payment in their browser; reconciled via webhook.
 *   - Stripe: returns a clientSecret for Stripe.js confirmation.
 *
 * Creates a `payments` row (status pending) storing provider_ref in
 * callback_payload so webhooks can reconcile it.
 *
 * With no processor configured the legacy Daraja stub path is used
 * (MPESA_MODE=stub performs no network call).
 */
import { NextRequest } from 'next/server';
import { requireMember, handleGuardError } from '@/lib/guard';
import { resolveProcessor } from '@/lib/payments';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireMember(request);
    const { userId, admin } = ctx;
    const body = await request.json().catch(() => ({}));
    const { invoiceId, phone, email } = body as { invoiceId?: string; phone?: string; email?: string };

    if (!invoiceId) {
      return Response.json({ error: 'invoiceId is required' }, { status: 400 });
    }

    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('org_id', ctx.orgId)
      .single();
    if (invErr || !invoice) {
      return Response.json({ error: 'invoice not found' }, { status: 404 });
    }
    if (invoice.member_id !== userId) {
      return Response.json({ error: 'forbidden', message: 'Invoice does not belong to you' }, { status: 403 });
    }
    if (!['pending', 'overdue'].includes(invoice.status)) {
      return Response.json(
        { error: 'invalid_invoice_status', message: `Invoice is ${invoice.status}` },
        { status: 400 },
      );
    }

    const currency: string = invoice.currency_code ?? ctx.org.currency_code ?? 'KES';
    const proc = await resolveProcessor(admin, ctx.orgId, 'collections', currency);

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const result = await proc.collect({
      amountMinor: invoice.amount,
      currency,
      phone,
      email: email ?? undefined,
      memberName: (profile as { full_name?: string } | null)?.full_name ?? undefined,
      accountRef: invoice.id,
      description: `Welfare contribution invoice ${invoice.id.slice(0, 8)}`,
      returnUrl: `${appUrl}/member/invoices?paid=${invoice.id}`,
    });

    const { data: payment, error: payErr } = await admin
      .from('payments')
      .insert({
        org_id: ctx.orgId,
        member_id: userId,
        invoice_id: invoice.id,
        amount: invoice.amount,
        currency_code: currency,
        channel: result.channel,
        status: 'pending',
        callback_payload: {
          provider_ref: result.providerRef,
          processor: proc.processor,
          checkoutRequestID:
            result.nextAction.kind === 'stk_sent' ? result.nextAction.providerRef : undefined,
        },
      })
      .select()
      .single();
    if (payErr || !payment) {
      return Response.json({ error: 'failed to record payment', message: payErr?.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: userId,
      action: 'collection_initiated',
      entity: 'payment',
      entityId: payment.id,
      orgId: ctx.orgId,
      details: { invoiceId: invoice.id, processor: proc.processor, providerRef: result.providerRef },
    });

    const base = { paymentId: payment.id, processor: proc.processor, channel: result.channel };
    const na = result.nextAction;
    if (na.kind === 'redirect') {
      return Response.json({
        ...base,
        authorizationUrl: na.url,
        message: 'Complete your payment in the opened page; it will confirm automatically.',
      });
    }
    if (na.kind === 'client_secret') {
      return Response.json({
        ...base,
        clientSecret: na.clientSecret,
        publishableKey: proc.creds.publishable_key ?? null,
        message: 'Confirm the payment to complete.',
      });
    }
    return Response.json({
      ...base,
      checkoutRequestId: na.providerRef,
      message: na.detail,
    });
  } catch (e) {
    if (e instanceof Error && /phone|processor_currency_unsupported|mpesa_kes_only/i.test(e.message)) {
      return Response.json({ error: 'payment_error', message: e.message }, { status: 400 });
    }
    if (e instanceof Error && /failed|key|credential|secret/i.test(e.message)) {
      return Response.json({ error: 'processor_error', message: e.message }, { status: 502 });
    }
    return handleGuardError(e);
  }
}
