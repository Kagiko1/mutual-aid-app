import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { getOrgConfig, money } from '@/lib/admin/config';
import { Card, PageHeader, EmptyState, inputCls, btnPrimary, btnDanger } from '@/components/admin/ui';

const TRIGGER_EVENTS = ['case_approval', 'case_disbursement', 'invoice_paid', 'member_joined', 'drip_run'];
const ENGINES = ['flat_rate', 'proportional_split'];

export default async function FundsPage() {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);
  const cfg = await getOrgConfig(orgId);

  async function createFund(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    const name = String(formData.get('name') || '').trim();
    if (name) await admin.from('funds').insert({ org_id: orgId, name });
    revalidatePath('/admin/funds');
  }

  async function createTrigger(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(String(formData.get('config') || '{}'));
    } catch {
      config = {};
    }
    await admin.from('fund_triggers').insert({
      org_id: orgId,
      fund_id: String(formData.get('fund_id')),
      trigger_event: String(formData.get('trigger_event')),
      engine: String(formData.get('engine')),
      config,
    });
    revalidatePath('/admin/funds');
  }

  async function deleteTrigger(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('fund_triggers').delete().eq('org_id', orgId).eq('id', String(formData.get('id')));
    revalidatePath('/admin/funds');
  }

  const [{ data: funds }, { data: triggers }] = await Promise.all([
    admin.from('funds').select('*').eq('org_id', orgId).order('name'),
    admin.from('fund_triggers').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
  ]);
  const fundRows = (funds ?? []) as { id: string; name: string; balance: number; policy: unknown }[];
  const triggerRows = (triggers ?? []) as {
    id: string;
    fund_id: string;
    trigger_event: string;
    engine: string;
    config: unknown;
  }[];
  const fundName = new Map(fundRows.map((f) => [f.id, f.name]));

  return (
    <div>
      <PageHeader title="Funds" subtitle="Wallets and the triggers that move money between them." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Funds">
          {fundRows.length === 0 ? (
            <EmptyState message="No funds yet. Create one below." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {fundRows.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-slate-900">{f.name}</span>
                  <span className="text-sm font-semibold text-slate-900">{money(f.balance, cfg)}</span>
                </li>
              ))}
            </ul>
          )}
          <form action={createFund} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
            <input name="name" required placeholder="New fund name…" className={inputCls} />
            <button type="submit" className={btnPrimary}>Add fund</button>
          </form>
        </Card>

        <Card title="New fund trigger">
          <form action={createTrigger} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Fund</label>
              <select name="fund_id" required className={inputCls} defaultValue="">
                <option value="" disabled>Select fund…</option>
                {fundRows.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Trigger event</label>
                <select name="trigger_event" className={inputCls}>
                  {TRIGGER_EVENTS.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Engine</label>
                <select name="engine" className={inputCls}>
                  {ENGINES.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Config (JSON)</label>
              <textarea
                name="config"
                rows={4}
                defaultValue={'{\n  "amount": 0\n}'}
                className={`${inputCls} font-mono`}
              />
              <p className="mt-1 text-xs text-slate-400">Invalid JSON is stored as an empty object.</p>
            </div>
            <button type="submit" className={btnPrimary}>Create trigger</button>
          </form>
        </Card>
      </div>

      <Card title="Fund triggers" className="mt-6">
        {triggerRows.length === 0 ? (
          <EmptyState message="No triggers configured." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Fund</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Event</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Engine</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Config</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {triggerRows.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{fundName.get(t.fund_id) ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{t.trigger_event}</td>
                    <td className="px-4 py-3 text-slate-600">{t.engine}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        {JSON.stringify(t.config)}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={deleteTrigger}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className={btnDanger}>Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
