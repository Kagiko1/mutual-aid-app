import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDay } from '@/lib/admin/config';
import { PageHeader, StatusPill, EmptyState, inputCls, btnPrimary } from '@/components/admin/ui';

const STATUSES = ['all', 'pending', 'active', 'ineligible', 'suspended'];

export default async function MembersPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const supabase = createClient();
  const q = (searchParams.q ?? '').trim();
  const status = searchParams.status ?? 'all';

  let query = supabase.from('profiles').select('id, full_name, email, phone, national_id, role, status, joined_at').order('joined_at', { ascending: false });
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (status !== 'all') query = query.eq('status', status);
  const { data: profiles } = await query;
  const rows = (profiles ?? []) as {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    joined_at: string;
  }[];

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="All member and admin profiles."
        actions={
          <Link href="/admin/members/new" className={btnPrimary}>
            Onboard on behalf
          </Link>
        }
      />

      <form method="get" action="/admin/members" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, email, phone…" className={`${inputCls} max-w-xs`} />
        <select name="status" defaultValue={status} className={`${inputCls} w-auto`}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <button type="submit" className={btnPrimary}>
          Filter
        </button>
        {(q || status !== 'all') && (
          <Link href="/admin/members" className="inline-flex items-center px-2 text-sm text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Contact</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{p.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{p.role}</td>
                <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                <td className="px-4 py-3 text-slate-500">{fmtDay(p.joined_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/members/${p.id}`} className="font-medium text-slate-700 hover:text-slate-900">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState message="No members match this search." />}
      </div>
    </div>
  );
}
