import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { formatMoney } from '@/lib/currency';
import { Card, PageHeader, StatusPill } from '@/components/admin/ui';
import { OrgStatusForm, OrgPlanForm, FxRateForm } from '@/components/admin/SuperControls';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  currency_code: string;
  invite_code: string;
  status: string;
  created_at: string;
  plan_id: string | null;
  plan_name: string | null;
}

export default async function SuperAdminPage() {
  const admin = createAdminClient();
  const { profile } = await resolveOrgContext(admin);

  if (!profile.is_super_admin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold text-slate-900">Not authorized</h1>
        <p className="mt-2 text-sm text-slate-600">
          This area is reserved for platform super-administrators.
        </p>
      </div>
    );
  }

  const [
    { data: orgs },
    { data: plans },
    { data: subs },
    { data: profiles },
    { data: fxRates },
  ] = await Promise.all([
    admin.from('organizations').select('id, name, slug, currency_code, invite_code, status, created_at').order('created_at', { ascending: false }),
    admin.from('plans').select('id, name, price_minor, currency_code, interval, max_members').order('price_minor'),
    admin.from('subscriptions').select('org_id, plan_id, status'),
    admin.from('profiles').select('org_id'),
    admin.from('fx_rates').select('base_currency, quote_currency, rate').order('quote_currency'),
  ]);

  const planById = new Map(((plans ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const subByOrg = new Map(((subs ?? []) as { org_id: string; plan_id: string; status: string }[]).map((s) => [s.org_id, s]));
  const membersByOrg = new Map<string, number>();
  for (const p of ((profiles ?? []) as { org_id: string }[])) {
    membersByOrg.set(p.org_id, (membersByOrg.get(p.org_id) ?? 0) + 1);
  }

  const orgRows: OrgRow[] = ((orgs ?? []) as Omit<OrgRow, 'plan_id' | 'plan_name'>[]).map((o) => {
    const s = subByOrg.get(o.id);
    return { ...o, plan_id: s?.plan_id ?? null, plan_name: s ? planById.get(s.plan_id) ?? null : null };
  });

  // MRR in USD: sum active/trial subscription plan prices converted via fx_rates.
  const fx = new Map(
    ((fxRates ?? []) as { base_currency: string; quote_currency: string; rate: number }[]).map((r) => [
      `${r.base_currency}>${r.quote_currency}`,
      Number(r.rate),
    ]),
  );
  const planPrice = new Map(
    ((plans ?? []) as { id: string; price_minor: number; currency_code: string }[]).map((p) => [
      p.id,
      { minor: Number(p.price_minor), code: p.currency_code },
    ]),
  );
  let mrrUsdMinor = 0;
  for (const s of (subs ?? []) as { plan_id: string; status: string }[]) {
    if (s.status !== 'active' && s.status !== 'trial') continue;
    const pp = planPrice.get(s.plan_id);
    if (!pp) continue;
    const rate = fx.get(`USD>${pp.code}`) ?? (pp.code === 'USD' ? 1 : null);
    if (!rate) continue;
    mrrUsdMinor += Math.round(pp.minor / rate);
  }

  const totalOrgs = orgRows.length;
  const totalMembers = (profiles ?? []).length;

  return (
    <div>
      <PageHeader title="Super Admin" subtitle="Platform-wide SaaS operations." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Organizations</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrgs}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Members</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalMembers}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">MRR (USD)</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(mrrUsdMinor, 'USD')}</p>
          <p className="mt-1 text-xs text-slate-500">Active + trial subscriptions</p>
        </div>
      </div>

      <Card title="Organizations" className="mt-6">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Organization</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Members</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Invite code</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgRows.map((o) => (
                <tr key={o.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{o.name}</p>
                    <p className="text-xs text-slate-500">
                      {o.slug} · {o.currency_code}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{membersByOrg.get(o.id) ?? 0}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{o.invite_code}</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="mb-1">
                      <StatusPill status={o.status} />
                    </div>
                    <OrgStatusForm orgId={o.id} current={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="mb-1 text-xs text-slate-500">{o.plan_name ?? '—'}</p>
                    <OrgPlanForm
                      orgId={o.id}
                      plans={(plans ?? []) as { id: string; name: string }[]}
                      currentPlanId={o.plan_id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgRows.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No organizations yet.</p>
          )}
        </div>
      </Card>

      <Card title="FX rates (1 USD = rate)" className="mt-6">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Pair</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {((fxRates ?? []) as { base_currency: string; quote_currency: string; rate: number }[]).map((r) => (
                <tr key={`${r.base_currency}-${r.quote_currency}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {r.base_currency} → {r.quote_currency}
                  </td>
                  <td className="px-4 py-3">
                    <FxRateForm base={r.base_currency} quote={r.quote_currency} rate={Number(r.rate)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
