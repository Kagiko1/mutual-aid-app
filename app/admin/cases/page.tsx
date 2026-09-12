import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgConfig, money, fmtDate } from '@/lib/admin/config';
import { PageHeader, StatusPill, EmptyState } from '@/components/admin/ui';

const STATUSES = ['all', 'draft', 'pending_review', 'reviewed', 'approved', 'disbursed', 'rejected'];

export default async function CasesPage({ searchParams }: { searchParams: { status?: string } }) {
  const cfg = await getOrgConfig();
  const supabase = createClient();
  const status = searchParams.status ?? 'all';

  let query = supabase.from('cases').select('*').order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);
  const { data: cases } = await query;
  const caseRows = (cases ?? []) as {
    id: string;
    member_id: string;
    case_type: string;
    deceased_name: string;
    benefit_amount: number;
    status: string;
    created_at: string;
    created_by_admin: boolean;
  }[];

  const memberIds = Array.from(new Set(caseRows.map((c) => c.member_id)));
  const { data: profiles } = memberIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', memberIds)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return (
    <div>
      <PageHeader title="Cases" subtitle="Review queue for welfare claims." />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/cases' : `/admin/cases?status=${s}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              status === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Deceased</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Claimant</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Type</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500">Amount</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {caseRows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.deceased_name}
                  {c.created_by_admin && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      admin-created
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{nameOf.get(c.member_id) ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.case_type}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">{money(c.benefit_amount, cfg)}</td>
                <td className="px-4 py-3">
                  <StatusPill status={c.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(c.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/cases/${c.id}`} className="font-medium text-slate-700 hover:text-slate-900">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {caseRows.length === 0 && <EmptyState message="No cases match this filter." />}
      </div>
    </div>
  );
}
