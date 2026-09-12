import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getOrgConfig, money, fmtDate } from '@/lib/admin/config';
import { Card, PageHeader, StatusPill } from '@/components/admin/ui';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default async function AdminDashboard() {
  const cfg = await getOrgConfig();
  const admin = createAdminClient();

  const [{ data: lastReserve }, { data: funds }, { data: disbursements }, { data: invoices }, { data: audit }] =
    await Promise.all([
      admin.from('reserve_ledger').select('balance_after, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('funds').select('id, name, balance').order('name'),
      admin.from('disbursements').select('amount').eq('status', 'completed'),
      admin.from('invoices').select('amount, status'),
      admin.from('audit_log').select('*').order('created_at', { ascending: false }).limit(5),
    ]);

  const reserveBalance = Number((lastReserve as { balance_after?: number } | null)?.balance_after ?? 0);
  const fundList = (funds ?? []) as { id: string; name: string; balance: number }[];
  const welfareFund = fundList.find((f) => f.name.toLowerCase().includes('welfare')) ?? fundList[0];

  const totalDisbursed = (disbursements ?? []).reduce((s, d) => s + Number((d as { amount: number }).amount), 0);
  const invRows = (invoices ?? []) as { amount: number; status: string }[];
  const totalInvoiced = invRows.reduce((s, i) => s + Number(i.amount), 0);
  const paidInvoiced = invRows.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
  const outstanding = invRows
    .filter((i) => i.status === 'pending' || i.status === 'overdue')
    .reduce((s, i) => s + Number(i.amount), 0);
  const collectionRate = totalInvoiced > 0 ? (paidInvoiced / totalInvoiced) * 100 : 0;

  const auditRows = (audit ?? []) as { id: string; actor_id: string | null; action: string; entity: string | null; created_at: string }[];
  const actorIds = Array.from(new Set(auditRows.map((a) => a.actor_id).filter(Boolean))) as string[];
  const { data: actors } = actorIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', actorIds as string[])
    : { data: [] };
  const actorName = new Map(((actors ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Fund health, collections and recent admin activity." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Reserve Fund" value={money(reserveBalance, cfg)} sub="Latest ledger balance" />
        <StatCard
          label={welfareFund ? welfareFund.name : 'Welfare Fund'}
          value={welfareFund ? money(welfareFund.balance, cfg) : money(0, cfg)}
          sub="Fund balance"
        />
        <StatCard label="Total disbursed" value={money(totalDisbursed, cfg)} sub="Completed disbursements" />
        <StatCard
          label="Collection rate"
          value={`${collectionRate.toFixed(1)}%`}
          sub={`${money(paidInvoiced, cfg)} of ${money(totalInvoiced, cfg)} invoiced`}
        />
        <StatCard label="Outstanding invoices" value={money(outstanding, cfg)} sub="Pending + overdue" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="Funds"
          action={
            <Link href="/admin/funds" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Manage
            </Link>
          }
        >
          {fundList.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No funds configured yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {fundList.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-slate-800">{f.name}</span>
                  <span className="text-sm font-semibold text-slate-900">{money(f.balance, cfg)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent audit activity"
          action={
            <Link href="/admin/audit" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              View all
            </Link>
          }
        >
          {auditRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No audit entries yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {auditRows.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{a.action}</p>
                    <p className="text-xs text-slate-500">
                      {actorName.get(a.actor_id ?? '') ?? 'system'}
                      {a.entity ? ` · ${a.entity}` : ''} · {fmtDate(a.created_at)}
                    </p>
                  </div>
                  <StatusPill status={a.entity ?? 'event'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
