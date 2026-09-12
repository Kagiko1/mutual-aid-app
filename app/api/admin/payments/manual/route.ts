/**
 * POST /api/admin/payments/manual
 * Body: { invoiceId, amountMinor, channel?: 'manual'|'bank', mpesaReceipt? }
 *
 * Admin-only, TOTP-gated. Records an offline/manual payment as completed,
 * marks the invoice paid, and AUTO-REACTIVATES the member
 * (status 'ineligible' -> 'active') — same as the M-Pesa callback.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, checkTotp, handleGuardError } from '@/lib/guard';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';
import { formatMoney } from '@/lib/money';

const CHANNELS = ['manual', 'bank'];

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    checkTotp(request, profile);

    const body = await request.json().catch(() => ({}));
    const { invoiceId, amountMinor, channel, mpesaReceipt } = body as {
      invoiceId?: string;
      amountMinor?: number;
      channel?: string;
      mpesaReceipt?: string;
    };

    if (!invoiceId || !Number.isInteger(amountMinor) || (amountMinor as number) <= 0) {
      return Response.json({ error: 'invoiceId and a positive integer amountMinor are required' }, { status: 400 });
    }
    const ch = channel ?? 'manual';
    if (!CHANNELS.includes(ch)) {
      return Response.json({ error: `channel must be one of: ${CHANNELS.join(', ')}` }, { status: 400 });
    }

    const { data: invoice } = await admin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('org_id', ctx.orgId)
      .single();
    if (!invoice) return Response.json({ error: 'invoice not found' }, { status: 404 });
    if (invoice.status === 'paid') {
      return Response.json({ error: 'invoice already paid' }, { status: 400 });
    }
    const currencyCode: string = invoice.currency_code ?? 'KES';

    const now = new Date().toISOString();
    const { data: payment, error: payErr } = await admin
      .from('payments')
      .insert({
        org_id: ctx.orgId,
        member_id: invoice.member_id,
        invoice_id: invoice.id,
        amount: amountMinor,
        currency_code: currencyCode,
        channel: ch,
        mpesa_receipt: mpesaReceipt ?? null,
        status: 'completed',
        paid_at: now,
        callback_payload: { recorded_by: profile.id, manual: true },
      })
      .select()
      .single();
    if (payErr || !payment) {
      return Response.json({ error: 'failed to record payment', message: payErr?.message }, { status: 500 });
    }

    await admin.from('invoices').update({ status: 'paid', paid_at: now }).eq('id', invoice.id).eq('org_id', ctx.orgId);

    // AUTO-REACTIVATION (mirrors /api/mpesa/callback)
    const { data: memberProfile } = await admin
      .from('profiles')
      .select('id, status')
      .eq('id', invoice.member_id)
      .eq('org_id', ctx.orgId)
      .single();
    let reactivated = false;
    if (memberProfile && memberProfile.status === 'ineligible') {
      await admin.from('profiles').update({ status: 'active' }).eq('id', memberProfile.id);
      reactivated = true;
    }

    await notifyMember(admin, {
      memberId: invoice.member_id,
      title: 'Payment recorded',
      body: `A ${ch} payment of ${formatMoney(amountMinor as number, currencyCode)} has been recorded against your invoice.${
        reactivated ? ' Your membership has been reactivated.' : ''
      }`,
      type: 'payment',
      orgId: ctx.orgId,
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: 'manual_payment_recorded',
      entity: 'payment',
      entityId: payment.id,
      orgId: ctx.orgId,
      details: { invoiceId: invoice.id, amountMinor, channel: ch, reactivated },
    });

    return Response.json({ payment, reactivated }, { status: 201 });
  } catch (e) {
    return handleGuardError(e);
  }
}
