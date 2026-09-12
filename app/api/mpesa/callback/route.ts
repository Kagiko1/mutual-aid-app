/**
 * POST /api/mpesa/callback
 * Daraja STK push async callback (ResultURL/CallBackURL). No auth — Daraja
 * calls this directly. Always answers {ResultCode:0} so Safaricom stops retrying.
 *
 * Body shape: { Body: { stkCallback: { CheckoutRequestID, ResultCode, ResultDesc,
 *   CallbackMetadata: { Item: [{ Name, Value }] } } } }
 *
 * ResultCode 0 -> payment completed: mpesa_receipt from CallbackMetadata
 * (MpesaReceiptNumber), invoice -> paid, and the member is AUTO-REACTIVATED
 * (status 'ineligible' -> 'active').
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';
import { formatMoney } from '@/lib/money';

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  try {
    const body = await request.json().catch(() => ({}));
    const cb = body?.Body?.stkCallback;
    const checkoutRequestId: string | undefined = cb?.CheckoutRequestID;
    const resultCode: number | undefined = cb?.ResultCode;
    console.log('[mpesa] STK callback received:', JSON.stringify({ checkoutRequestId, resultCode }));

    if (!checkoutRequestId) {
      console.warn('[mpesa] callback missing CheckoutRequestID');
      return Response.json(ACCEPTED);
    }

    const { data: payment } = await admin
      .from('payments')
      .select('*')
      .filter('callback_payload->>checkoutRequestID', 'eq', checkoutRequestId)
      .single();

    if (!payment) {
      console.warn(`[mpesa] no payment found for checkoutRequestId=${checkoutRequestId}`);
      return Response.json(ACCEPTED);
    }

    // Tenant scope: callbacks are unauthenticated, so resolve the org from the
    // payment -> invoice chain (payments recorded by stk-push carry org_id).
    const { data: invRow } = payment.invoice_id
      ? await admin
          .from('invoices')
          .select('id, org_id, currency_code')
          .eq('id', payment.invoice_id)
          .single()
      : { data: null };
    const orgId: string | null =
      (payment.org_id as string | null) ?? (invRow?.org_id as string | null) ?? null;
    const currencyCode: string =
      (payment.currency_code as string | null) ?? (invRow?.currency_code as string | null) ?? 'KES';

    const items: { Name?: string; Value?: unknown }[] =
      cb?.CallbackMetadata?.Item ?? [];
    const receiptItem = items.find((i) => i.Name === 'MpesaReceiptNumber');
    const mpesaReceipt = receiptItem?.Value != null ? String(receiptItem.Value) : null;

    if (resultCode === 0) {
      const now = new Date().toISOString();
      let payUpdate = admin
        .from('payments')
        .update({ status: 'completed', mpesa_receipt: mpesaReceipt, paid_at: now })
        .eq('id', payment.id);
      if (orgId) payUpdate = payUpdate.eq('org_id', orgId);
      await payUpdate;

      let invoice: Record<string, unknown> | null = null;
      if (payment.invoice_id) {
        let invUpdate = admin
          .from('invoices')
          .update({ status: 'paid', paid_at: now })
          .eq('id', payment.invoice_id);
        if (orgId) invUpdate = invUpdate.eq('org_id', orgId);
        const { data } = await invUpdate.select().single();
        invoice = data;
      }

      // AUTO-REACTIVATION: a member penalized to 'ineligible' becomes active again on payment.
      let profQuery = admin
        .from('profiles')
        .select('id, status')
        .eq('id', payment.member_id);
      if (orgId) profQuery = profQuery.eq('org_id', orgId);
      const { data: profile } = await profQuery.single();
      let reactivated = false;
      if (profile && profile.status === 'ineligible') {
        await admin.from('profiles').update({ status: 'active' }).eq('id', profile.id);
        reactivated = true;
      }

      await notifyMember(admin, {
        memberId: payment.member_id,
        title: 'Payment received',
        body: `Your contribution of ${formatMoney(payment.amount, currencyCode)} has been received${
          mpesaReceipt ? ` (receipt ${mpesaReceipt})` : ''
        }.${reactivated ? ' Your membership has been reactivated.' : ''}`,
        type: 'payment',
        orgId,
      });

      await logAudit(admin, {
        actorId: null,
        action: 'payment_completed',
        entity: 'payment',
        entityId: payment.id,
        orgId,
        details: {
          invoiceId: payment.invoice_id,
          mpesaReceipt,
          amount: payment.amount,
          reactivated,
          invoicePaid: !!invoice,
        },
      });
    } else {
      let failUpdate = admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      if (orgId) failUpdate = failUpdate.eq('org_id', orgId);
      await failUpdate;
      await logAudit(admin, {
        actorId: null,
        action: 'payment_failed',
        entity: 'payment',
        entityId: payment.id,
        orgId,
        details: { resultCode, resultDesc: cb?.ResultDesc },
      });
      console.warn(`[mpesa] STK payment failed for ${checkoutRequestId}: ResultCode=${resultCode}`);
    }

    return Response.json(ACCEPTED);
  } catch (e) {
    console.error('[mpesa] callback handler error:', e);
    // Still acknowledge — never let Safaricom retry-loop on our bug.
    return Response.json(ACCEPTED);
  }
}
