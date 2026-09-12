/**
 * Shared payment reconciliation: mark a collection payment completed/failed,
 * settle its invoice, auto-reactivate the member, notify, and audit.
 * Used by the Daraja STK callback and the generic processor webhooks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAudit } from '../audit';
import { notifyMember } from '../notify';
import { formatMoney } from '../money';

export async function completeCollectionPayment(
  admin: SupabaseClient,
  payment: Record<string, unknown>,
  opts: { receipt?: string | null; orgId?: string | null; currencyCode?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const orgId = opts.orgId ?? (payment.org_id as string | null) ?? null;
  const currencyCode = opts.currencyCode ?? (payment.currency_code as string | null) ?? 'KES';

  let payUpdate = admin
    .from('payments')
    .update({ status: 'completed', mpesa_receipt: opts.receipt ?? null, paid_at: now })
    .eq('id', payment.id as string);
  if (orgId) payUpdate = payUpdate.eq('org_id', orgId);
  await payUpdate;

  let invoicePaid = false;
  if (payment.invoice_id) {
    let invUpdate = admin
      .from('invoices')
      .update({ status: 'paid', paid_at: now })
      .eq('id', payment.invoice_id as string);
    if (orgId) invUpdate = invUpdate.eq('org_id', orgId);
    const { data } = await invUpdate.select('id').single();
    invoicePaid = !!data;
  }

  // AUTO-REACTIVATION: a member penalized to 'ineligible' becomes active again.
  let profQuery = admin.from('profiles').select('id, status').eq('id', payment.member_id as string);
  if (orgId) profQuery = profQuery.eq('org_id', orgId);
  const { data: profile } = await profQuery.single();
  let reactivated = false;
  if (profile && (profile as { status: string }).status === 'ineligible') {
    await admin.from('profiles').update({ status: 'active' }).eq('id', (profile as { id: string }).id);
    reactivated = true;
  }

  await notifyMember(admin, {
    memberId: payment.member_id as string,
    title: 'Payment received',
    body: `Your contribution of ${formatMoney(Number(payment.amount), currencyCode)} has been received${
      opts.receipt ? ` (receipt ${opts.receipt})` : ''
    }.${reactivated ? ' Your membership has been reactivated.' : ''}`,
    type: 'payment',
    orgId,
  });

  await logAudit(admin, {
    actorId: null,
    action: 'payment_completed',
    entity: 'payment',
    entityId: payment.id as string,
    orgId,
    details: {
      invoiceId: payment.invoice_id,
      receipt: opts.receipt,
      amount: payment.amount,
      reactivated,
      invoicePaid,
      channel: payment.channel,
    },
  });
}

export async function failCollectionPayment(
  admin: SupabaseClient,
  payment: Record<string, unknown>,
  reason: string,
): Promise<void> {
  const orgId = (payment.org_id as string | null) ?? null;
  let failUpdate = admin.from('payments').update({ status: 'failed' }).eq('id', payment.id as string);
  if (orgId) failUpdate = failUpdate.eq('org_id', orgId);
  await failUpdate;
  await logAudit(admin, {
    actorId: null,
    action: 'payment_failed',
    entity: 'payment',
    entityId: payment.id as string,
    orgId,
    details: { reason, channel: payment.channel },
  });
}
