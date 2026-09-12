import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgConfig, money, fmtDate } from '@/lib/admin/config';
import { PageHeader, StatusPill, EmptyState, inputCls, btnPrimary } from '@/components/admin/ui';

const TABS = [
  { key: 'combined', label: 'Combined' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
];

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: { tab?: string; status?: string; channel?: string; q?: string };
}) {
  const cfg = await getOrgConfig();
  const supabase = createClient();
  const tab = searchParams.tab ?? 'combined';
  const status = searchParams.status ?? 'all';
  const channel = searchParams.channel ?? 'all';
  const q = (searchParams.q ?? '').trim();

  // member search → id set
  let memberIds: string[] | null = null;
  if (q) {
    const { data } = await supabase.from('profiles').select('id').or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    memberIds = ((data ?? []) as { id: string }[]).map((p) => p.id);
  }

  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  const invRows = ((invoices ?? []) as {
    id: string; member_id: string; amount: number; status: string; strategy: string | null; due_date: string | null; created_at: string;
  }[]).filter((i) => !memberIds || memberIds.includes(i.member_id))
    .filter((i) => status === 'all' || i.status === status);
  const payRows = ((payments ?? []) as {
    id: string; member_id: string; amount: number; channel: string; mpesa_receipt: string | null; status: string; paid_at: string | null; created_at: string;
  }[]).filter((p) => !memberIds || memberIds.includes(p.member_id))
    .filter((p) => channel === 'all' || p.channel === channel);

  const allMemberIds = Array.from(new Set([...invRows.map((i) => i.member_id), ...payRows.map((p) => p.member_id)]));
  const { data: profiles } = allMemberIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', allMemberIds)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  const totalInvoiced = invRows.reduce((s, i) => s + Number(i.amount), 0);
  const totalCollected = payRows.filter((p) => p.status === 'completed').reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = invRows.filter((i) => i.status === 'pending' || i.status === 'overdue').reduce((s, i) => s + Number(i.amount), 0);

  const combined = [
    ...invRows.map((i) => ({ kind: 'invoice' as const, id: i.id, at: i.created_at, member: nameOf.get(i.member_id) ?? '—', detail: `${i.strategy ?? '—'} · due ${i.due_date ?? '—'}`, amount: Number(i.amount), status: i.status })),
    ...payRows.map((p) => ({ kind: 'payment' as const, id: p.id, at: p.paid_at ?? p.created_at, member: nameOf.get(p.member_id) ?? '—', detail: `${p.channel}${p.mpesa_receipt ? ` · ${p.mpesa_receipt}` : ''}`, amount: Number(p.amount), status: p.status })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const qs = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ tab, status, channel, q, ...overrides });
    return `/admin/ledger?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Welfare ledger" subtitle="Invoices and payments across all members." />

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={qs({ tab: t.key })}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form method="get" action="/admin/ledger" className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder="Search member…" className={`${inputCls} max-w-xs`} />
        <select name="status" defaultValue={status} className={`${inputCls} w-auto`} title="Invoice status">
          {['all', 'pending', 'paid', 'overdue', 'waived'].map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'Any invoice status' : s}</option>
          ))}
        </select>
        <select name="channel" defaultValue={channel} className={`${inputCls} w-auto`} title="Payment channel">
          {['all', 'mpesa_stk', 'mpesa_b2c', 'manual', 'bank'].map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'Any channel' : s}</option>
          ))}
        </select>
        <button type="submit" className={btnPrimary}>Filter</button>
        {(q || status !== 'all' || channel !== 'all') && (
          <Link href={qs({ q: '', status: 'all', channel: 'all' })} className="inline-flex items-center px-2 text-sm text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total invoiced</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{money(totalInvoiced, cfg)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total collected</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">{money(totalCollected, cfg)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="mt-1 text-xl font-bold text-red-700">{money(outstanding, cfg)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {tab === 'combined' && <th className="px-4 py-3 text-left font-medium text-slate-500">Type</th>}
              <th className="px-4 py-3 text-left font-medium text-slate-500">Date</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Member</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Detail</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500">Amount</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tab === 'combined' &&
              combined.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{r.kind}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.member}</td>
                  <td className="px-4 py-3 text-slate-600">{r.detail}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{money(r.amount, cfg)}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                </tr>
              ))}
            {tab === 'invoices' &&
              invRows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(i.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{nameOf.get(i.member_id) ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{i.strategy ?? '—'} · due {i.due_date ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{money(i.amount, cfg)}</td>
                  <td className="px-4 py-3"><StatusPill status={i.status} /></td>
                </tr>
              ))}
            {tab === 'payments' &&
              payRows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(p.paid_at ?? p.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{nameOf.get(p.member_id) ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.channel}{p.mpesa_receipt ? ` · ${p.mpesa_receipt}` : ''}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{money(p.amount, cfg)}</td>
                  <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                </tr>
              ))}
          </tbody>
        </table>
        {((tab === 'combined' && combined.length === 0) ||
          (tab === 'invoices' && invRows.length === 0) ||
          (tab === 'payments' && payRows.length === 0)) && <EmptyState message="No ledger entries match these filters." />}
      </div>
    </div>
  );
}
