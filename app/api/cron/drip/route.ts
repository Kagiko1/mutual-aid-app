/**
 * GET /api/cron/drip
 * Daily contribution drip: T+4 reminder, T+6 final notice, T+7 penalty +
 * mark member ineligible. Runs via Vercel Cron (see vercel.json).
 *
 * Auth: ?secret=<CRON_SECRET> or Authorization: Bearer <CRON_SECRET>.
 *
 * Duplicate-action guard: before acting on an invoice we check audit_log for
 * a matching drip action on that invoice:
 *   - 'drip_reminder' / 'drip_final' — sent once per invoice (each maps to a
 *     distinct day-window of the drip engine, so later days move to the next action).
 *   - 'drip_penalty' — once ever per invoice.
 * Penalty invoices are also de-duplicated by lookup (same member+case+penalty amount).
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { dripActionFor } from '@/lib/engines/drip';
import { getOrgConfig } from '@/lib/org';
import { notifyMember } from '@/lib/notify';
import { logAudit } from '@/lib/audit';
import { formatMoney } from '@/lib/money';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

async function alreadyActed(admin: SupabaseClient, action: string, invoiceId: string): Promise<boolean> {
  const { data } = await admin
    .from('audit_log')
    .select('id')
    .eq('action', action)
    .eq('entity', 'invoice')
    .eq('entity_id', invoiceId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

interface InvoiceRow {
  id: string;
  member_id: string;
  case_id: string;
  amount: number;
  status: string;
  strategy: string | null;
  due_date: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.nextUrl.searchParams.get('secret') ??
    (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secret || provided !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const org = await getOrgConfig(admin);

  const { data: invoices, error } = await admin
    .from('invoices')
    .select('*')
    .in('status', ['pending', 'overdue']);
  if (error) {
    return Response.json({ error: 'failed to load invoices', message: error.message }, { status: 500 });
  }

  const summary = { processed: 0, reminders: 0, finalNotices: 0, penalties: 0 };
  const now = new Date();

  for (const inv of (invoices ?? []) as InvoiceRow[]) {
    const action = dripActionFor(inv.created_at, now);
    if (action === 'none') continue;
    summary.processed += 1;

    const amountStr = formatMoney(inv.amount, org.currencySymbol, org.currencyCode);

    if (action === 'reminder') {
      if (await alreadyActed(admin, 'drip_reminder', inv.id)) continue;
      const msg = `${org.orgName}: Reminder — your contribution of ${amountStr} is due. Pay via M-Pesa to stay eligible.`;
      await notifyMember(admin, { memberId: inv.member_id, title: 'Contribution reminder', body: msg, type: 'reminder' });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_reminder',
        entity: 'invoice',
        entityId: inv.id,
        details: { amount: inv.amount },
      });
      summary.reminders += 1;
    } else if (action === 'final_notice') {
      if (await alreadyActed(admin, 'drip_final', inv.id)) continue;
      const msg = `${org.orgName}: FINAL NOTICE — your contribution of ${amountStr} is overdue. Pay now or a penalty applies and your membership becomes ineligible.`;
      await notifyMember(admin, { memberId: inv.member_id, title: 'Final notice: contribution overdue', body: msg, type: 'final_notice' });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_final',
        entity: 'invoice',
        entityId: inv.id,
        details: { amount: inv.amount },
      });
      summary.finalNotices += 1;
    } else {
      // penalty_ineligible — once ever per invoice
      if (await alreadyActed(admin, 'drip_penalty', inv.id)) continue;

      // De-dupe: skip if a penalty invoice already exists for this member+case.
      const { data: existing } = await admin
        .from('invoices')
        .select('id')
        .eq('member_id', inv.member_id)
        .eq('case_id', inv.case_id)
        .eq('amount', org.penaltyAmountMinor)
        .limit(1);

      if (!existing || existing.length === 0) {
        const due = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
        await admin.from('invoices').insert({
          member_id: inv.member_id,
          case_id: inv.case_id,
          amount: org.penaltyAmountMinor,
          status: 'pending',
          strategy: inv.strategy,
          due_date: due,
        });
      }

      await admin.from('invoices').update({ status: 'overdue' }).eq('id', inv.id);
      await admin.from('profiles').update({ status: 'ineligible' }).eq('id', inv.member_id);

      const penaltyStr = formatMoney(org.penaltyAmountMinor, org.currencySymbol, org.currencyCode);
      const msg = `${org.orgName}: A penalty of ${penaltyStr} has been applied and your membership is now INELIGIBLE. Pay all outstanding amounts to be reactivated.`;
      await notifyMember(admin, { memberId: inv.member_id, title: 'Penalty applied: membership ineligible', body: msg, type: 'penalty' });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_penalty',
        entity: 'invoice',
        entityId: inv.id,
        details: { penaltyAmount: org.penaltyAmountMinor, amount: inv.amount },
      });
      summary.penalties += 1;
    }
  }

  await admin.from('drip_runs').insert({ summary: { ...summary, ranAt: now.toISOString() } });

  return Response.json({ ok: true, summary });
}
