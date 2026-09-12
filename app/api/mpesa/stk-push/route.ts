/**
 * POST /api/mpesa/stk-push
 * Body: { invoiceId, phone }
 *
 * Member-initiated M-Pesa STK push for one of their pending/overdue invoices.
 * Creates a `payments` row (status pending, channel mpesa_stk) and stores the
 * CheckoutRequestID in callback_payload so /api/mpesa/callback can reconcile.
 *
 * NOTE (stub mode): MPESA_MODE=stub performs no network call and Daraja never
 * sends an async callback, so the payment stays pending. Reconcile it via the
 * manual-payment route or by POSTing a simulated callback to /api/mpesa/callback.
 */
import { NextRequest } from 'next/server';
import { requireMember, handleGuardError } from '@/lib/guard';
import { stkPush } from '@/lib/mpesa';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const { userId, admin } = await requireMember();
    const body = await request.json().catch(() => ({}));
    const { invoiceId, phone } = body as { invoiceId?: string; phone?: string };

    if (!invoiceId || !phone) {
      return Response.json({ error: 'invoiceId and phone are required' }, { status: 400 });
    }

    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
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

    const result = await stkPush({
      phone,
      amountMinor: invoice.amount,
      accountRef: invoice.id,
      description: `Welfare contribution invoice ${invoice.id.slice(0, 8)}`,
    });

    const { data: payment, error: payErr } = await admin
      .from('payments')
      .insert({
        member_id: userId,
        invoice_id: invoice.id,
        amount: invoice.amount,
        channel: 'mpesa_stk',
        status: 'pending',
        callback_payload: {
          checkoutRequestID: result.checkoutRequestId,
          merchantRequestId: result.merchantRequestId,
        },
      })
      .select()
      .single();
    if (payErr || !payment) {
      return Response.json({ error: 'failed to record payment', message: payErr?.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: userId,
      action: 'stk_push_initiated',
      entity: 'payment',
      entityId: payment.id,
      details: { invoiceId: invoice.id, checkoutRequestId: result.checkoutRequestId },
    });

    return Response.json({ checkoutRequestId: result.checkoutRequestId, paymentId: payment.id });
  } catch (e) {
    if (e instanceof Error && /stkPush|Daraja|MPESA_|phone/i.test(e.message)) {
      return Response.json({ error: 'mpesa_error', message: e.message }, { status: 502 });
    }
    return handleGuardError(e);
  }
}
