/**
 * GET /api/cron/drip
 * Daily contribution drip: T+4 reminder, T+6 final notice, T+7 penalty +
 * mark member ineligible. Runs via Vercel Cron (see vercel.json).
 *
 * Multi-tenant: loops every organization with status in ('trial','active')
 * and runs the drip engine per org with that org's config, currency and
 * tenant scope. All reads/writes are scoped by org_id.
 *
 * Auth: ?secret=<CRON_SECRET> or Authorization: Bearer <CRON_SECRET>.
 *
 * Duplicate-action guard: before acting on an invoice we check audit_log for
 * a matching drip action on that invoice (scoped to the org):
 *   - 'drip_reminder' / 'drip_final' — sent once per invoice (each maps to a
 *     distinct day-window of the drip engine, so later days move to the next action).
 *   - 'drip_penalty' — once ever per invoice.
 * Penalty invoices are also de-duplicated by lookup (same member+case+penalty amount).
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { dripActionFor } from '@/lib/engines/drip';
import { getOrgConfig, type OrgConfig } from '@/lib/org';
import { notifyMember } from '@/lib/notify';
import { logAudit } from '@/lib/audit';
import { formatMoney } from '@/lib/money';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  currency_code: string;
  status: string;
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
  currency_code: string | null;
}

async function alreadyActed(
  admin: SupabaseClient,
  orgId: string,
  action: string,
  invoiceId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('audit_log')
    .select('id')
    .eq('org_id', orgId)
    .eq('action', action)
    .eq('entity', 'invoice')
    .eq('entity_id', invoiceId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

interface DripSummary {
  processed: number;
  reminders: number;
  finalNotices: number;
  penalties: number;
}

/** Run the drip engine for a single organization. All queries scoped by orgId. */
async function runDripForOrg(
  admin: SupabaseClient,
  org: OrgRow,
  cfg: OrgConfig,
  now: Date,
): Promise<DripSummary> {
  const orgId = org.id;
  const currencyCode = cfg.currencyCode || org.currency_code || 'KES';

  const { data: invoices, error } = await admin
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['pending', 'overdue']);
  if (error) {
    console.error(`[drip] failed to load invoices for org ${org.slug}:`, error.message);
    return { processed: 0, reminders: 0, finalNotices: 0, penalties: 0 };
  }

  const summary: DripSummary = { processed: 0, reminders: 0, finalNotices: 0, penalties: 0 };

  for (const inv of (invoices ?? []) as InvoiceRow[]) {
    const action = dripActionFor(inv.created_at, now);
    if (action === 'none') continue;
    summary.processed += 1;

    const invCurrency = inv.currency_code || currencyCode;
    const amountStr = formatMoney(inv.amount, invCurrency);

    if (action === 'reminder') {
      if (await alreadyActed(admin, orgId, 'drip_reminder', inv.id)) continue;
      const msg = `${cfg.orgName}: Reminder — your contribution of ${amountStr} is due. Pay to stay eligible.`;
      await notifyMember(admin, {
        memberId: inv.member_id,
        title: 'Contribution reminder',
        body: msg,
        type: 'reminder',
        orgId,
      });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_reminder',
        entity: 'invoice',
        entityId: inv.id,
        details: { amount: inv.amount },
        orgId,
      });
      summary.reminders += 1;
    } else if (action === 'final_notice') {
      if (await alreadyActed(admin, orgId, 'drip_final', inv.id)) continue;
      const msg = `${cfg.orgName}: FINAL NOTICE — your contribution of ${amountStr} is overdue. Pay now or a penalty applies and your membership becomes ineligible.`;
      await notifyMember(admin, {
        memberId: inv.member_id,
        title: 'Final notice: contribution overdue',
        body: msg,
        type: 'final_notice',
        orgId,
      });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_final',
        entity: 'invoice',
        entityId: inv.id,
        details: { amount: inv.amount },
        orgId,
      });
      summary.finalNotices += 1;
    } else {
      // penalty_ineligible — once ever per invoice
      if (await alreadyActed(admin, orgId, 'drip_penalty', inv.id)) continue;

      // De-dupe: skip if a penalty invoice already exists for this member+case.
      const { data: existing } = await admin
        .from('invoices')
        .select('id')
        .eq('org_id', orgId)
        .eq('member_id', inv.member_id)
        .eq('case_id', inv.case_id)
        .eq('amount', cfg.penaltyAmountMinor)
        .limit(1);

      if (!existing || existing.length === 0) {
        const due = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
        await admin.from('invoices').insert({
          org_id: orgId,
          member_id: inv.member_id,
          case_id: inv.case_id,
          amount: cfg.penaltyAmountMinor,
          currency_code: currencyCode,
          status: 'pending',
          strategy: inv.strategy,
          due_date: due,
        });
      }

      await admin.from('invoices').update({ status: 'overdue' }).eq('org_id', orgId).eq('id', inv.id);
      await admin.from('profiles').update({ status: 'ineligible' }).eq('org_id', orgId).eq('id', inv.member_id);

      const penaltyStr = formatMoney(cfg.penaltyAmountMinor, currencyCode);
      const msg = `${cfg.orgName}: A penalty of ${penaltyStr} has been applied and your membership is now INELIGIBLE. Pay all outstanding amounts to be reactivated.`;
      await notifyMember(admin, {
        memberId: inv.member_id,
        title: 'Penalty applied: membership ineligible',
        body: msg,
        type: 'penalty',
        orgId,
      });
      await logAudit(admin, {
        actorId: null,
        action: 'drip_penalty',
        entity: 'invoice',
        entityId: inv.id,
        details: { penaltyAmount: cfg.penaltyAmountMinor, amount: inv.amount },
        orgId,
      });
      summary.penalties += 1;
    }
  }

  await admin.from('drip_runs').insert({
    org_id: orgId,
    summary: { ...summary, ranAt: now.toISOString() },
  });

  return summary;
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
  const now = new Date();

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, name, slug, currency_code, status')
    .in('status', ['trial', 'active']);
  if (error) {
    return Response.json({ error: 'failed to load organizations', message: error.message }, { status: 500 });
  }

  const results: { slug: string; summary: DripSummary }[] = [];
  for (const org of (orgs ?? []) as OrgRow[]) {
    const cfg = await getOrgConfig(admin, org.id);
    const summary = await runDripForOrg(admin, org, cfg, now);
    results.push({ slug: org.slug, summary });
  }

  return Response.json({ ok: true, orgs: results });
}
