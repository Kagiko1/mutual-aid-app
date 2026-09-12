import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { getOrgConfig, fmtDay } from '@/lib/admin/config';
import { formatMoney } from '@/lib/currency';
import { Card, PageHeader, StatusPill } from '@/components/admin/ui';

interface Plan {
  id: string;
  name: string;
  price_minor: number;
  currency_code: string;
  interval: string;
  max_members: number | null;
  features: string[];
}

export default async function BillingPage() {
  const admin = createAdminClient();
  const { orgId, org } = await resolveOrgContext(admin);
  const cfg = await getOrgConfig(orgId);

  const { data: sub } = await admin
    .from('subscriptions')
    .select('*, plans(*)')
    .eq('org_id', orgId)
    .maybeSingle();
  const subscription = sub as {
    id: string;
    status: string;
    current_period_end: string | null;
    plans: Plan | null;
  } | null;

  const { count: memberCount } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  const plan = subscription?.plans ?? null;

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle={`Subscription for ${org.name} (${org.currency_code}).`}
        actions={
          <Link href="/admin" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ← Dashboard
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Current plan">
          {plan ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold text-slate-900">{plan.name}</p>
                <StatusPill status={subscription?.status ?? 'trial'} />
              </div>
              <p className="text-sm text-slate-600">
                {formatMoney(Number(plan.price_minor), plan.currency_code)}{' '}
                <span className="text-slate-400">/ {plan.interval}</span>
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Members</dt>
                  <dd className="font-medium text-slate-900">
                    {memberCount ?? 0}
                    {plan.max_members != null ? ` / ${plan.max_members}` : ' (unlimited)'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Current period ends</dt>
                  <dd className="font-medium text-slate-900">{fmtDay(subscription?.current_period_end)}</dd>
                </div>
              </dl>
              {Array.isArray(plan.features) && plan.features.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Features</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        {f.replace(/_/g, ' ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-slate-400">No subscription found for this organization.</p>
          )}
        </Card>

        <Card title="Plan changes">
          <p className="text-sm text-slate-600">
            Plan upgrades, downgrades and cancellations are handled by our support team to make
            sure billing stays correct for your organization.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            To change your plan, contact{' '}
            <a href="mailto:support@mutualaid.app" className="font-medium text-slate-900 underline">
              support@mutualaid.app
            </a>{' '}
            with your organization name (<strong>{org.name}</strong>) and the plan you&apos;d like.
          </p>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Billing is managed centrally by the platform team (super-admin managed).
          </p>
        </Card>
      </div>
    </div>
  );
}
