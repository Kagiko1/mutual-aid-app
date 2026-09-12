import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/admin/config';
import { PageHeader, EmptyState, inputCls, btnPrimary } from '@/components/admin/ui';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { action?: string; entity?: string; date?: string };
}) {
  const supabase = createClient();
  const action = (searchParams.action ?? '').trim();
  const entity = (searchParams.entity ?? '').trim();
  const date = (searchParams.date ?? '').trim();

  let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (action) query = query.ilike('action', `%${action}%`);
  if (entity) query = query.ilike('entity', `%${entity}%`);
  if (date) {
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    query = query.gte('created_at', `${date}T00:00:00`).lt('created_at', next.toISOString().slice(0, 10) + 'T00:00:00');
  }
  const { data: entries } = await query;
  const rows = (entries ?? []) as {
    id: string;
    actor_id: string | null;
    action: string;
    entity: string | null;
    entity_id: string | null;
    details: unknown;
    created_at: string;
  }[];

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] };
  const actorName = new Map(((actors ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Immutable record of admin actions, newest first." />

      <form method="get" action="/admin/audit" className="mb-4 flex flex-wrap gap-2">
        <input name="action" defaultValue={action} placeholder="Filter action…" className={`${inputCls} max-w-xs`} />
        <input name="entity" defaultValue={entity} placeholder="Filter entity…" className={`${inputCls} max-w-xs`} />
        <input name="date" type="date" defaultValue={date} className={`${inputCls} w-auto`} />
        <button type="submit" className={btnPrimary}>Filter</button>
        {(action || entity || date) && (
          <Link href="/admin/audit" className="inline-flex items-center px-2 text-sm text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">When</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Actor</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Action</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Entity</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {r.actor_id ? actorName.get(r.actor_id) ?? r.actor_id.slice(0, 8) : 'system'}
                </td>
                <td className="px-4 py-3 text-slate-800">{r.action}</td>
                <td className="px-4 py-3 text-slate-600">
                  {r.entity ?? '—'}
                  {r.entity_id ? <span className="text-xs text-slate-400"> · {r.entity_id.slice(0, 8)}</span> : null}
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-500" title={JSON.stringify(r.details)}>
                  {r.details ? JSON.stringify(r.details) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState message="No audit entries match these filters." />}
      </div>
    </div>
  );
}
