import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { getOrgConfig } from '@/lib/admin/config';
import { formatMoney } from '@/lib/money';
import { waitingDaysRemaining } from '@/lib/engines/waitingPeriod';

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800',
    pending: 'bg-yellow-100 text-yellow-800',
    ineligible: 'bg-red-100 text-red-800',
    suspended: 'bg-gray-200 text-gray-700',
    draft: 'bg-gray-100 text-gray-700',
    pending_review: 'bg-yellow-100 text-yellow-800',
    reviewed: 'bg-blue-100 text-blue-800',
    approved: 'bg-emerald-100 text-emerald-800',
    disbursed: 'bg-emerald-200 text-emerald-900',
    rejected: 'bg-red-100 text-red-800',
    paid: 'bg-emerald-100 text-emerald-800',
    overdue: 'bg-red-100 text-red-800',
    waived: 'bg-gray-100 text-gray-600',
  };
  const label = status.replace(/_/g, ' ');
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
        styles[status] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {label}
    </span>
  );
}

export default async function MemberDashboard() {
  const admin = createAdminClient();
  const { orgId, profile: ctxProfile } = await resolveOrgContext(admin);
  const cfg = await getOrgConfig(orgId);

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, status, joined_at, waiting_ends_at')
    .eq('id', ctxProfile.id)
    .eq('org_id', orgId)
    .maybeSingle();

  const { data: cases } = await admin
    .from('cases')
    .select('id, case_type, deceased_name, status, benefit_amount, created_at')
    .eq('member_id', ctxProfile.id)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, amount, status, due_date, case_id')
    .eq('member_id', ctxProfile.id)
    .eq('org_id', orgId)
    .in('status', ['pending', 'overdue'])
    .order('due_date', { ascending: true })
    .limit(5);

  const { data: notifications } = await admin
    .from('notifications')
    .select('id, title, body, created_at, read_at')
    .eq('member_id', ctxProfile.id)
    .eq('org_id', orgId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: leadership } = await admin
    .from('leadership_contacts')
    .select('id, name, role, phone, email')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(4);

  const waitingRemaining = profile
    ? waitingDaysRemaining(profile.joined_at, cfg.waiting_period_days)
    : 0;
  const dueTotal = (invoices ?? []).reduce((sum: number, i: any) => sum + Number(i.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
      </h1>

      {profile?.status === 'pending' && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          Your membership is pending. Complete the onboarding steps to activate your account.{' '}
          <Link href="/member/onboarding" className="font-semibold underline">
            Continue onboarding
          </Link>
        </div>
      )}
      {profile?.status === 'ineligible' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Your membership is currently ineligible. Settle outstanding invoices to reactivate.{' '}
          <Link href="/member/invoices" className="font-semibold underline">
            View invoices
          </Link>
        </div>
      )}

      {/* Profile status card */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Membership status
          </h2>
          <div className="mt-2">{statusBadge(profile?.status ?? 'pending')}</div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Member since</dt>
              <dd className="font-medium">
                {profile?.joined_at
                  ? new Date(profile.joined_at).toLocaleDateString()
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Waiting period</dt>
              <dd className="font-medium">
                {waitingRemaining > 0 ? `${waitingRemaining} days left` : 'Satisfied'}
              </dd>
            </div>
          </dl>
          <Link
            href="/member/cases/new"
            className="mt-4 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Raise a case
          </Link>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Invoices due
          </h2>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {formatMoney(dueTotal, cfg.currency_code)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {(invoices ?? []).length} invoice{(invoices ?? []).length === 1 ? '' : 's'} pending or
            overdue
          </p>
          <Link
            href="/member/invoices"
            className="mt-4 inline-block text-sm font-semibold text-emerald-700 hover:underline"
          >
            View all invoices
          </Link>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            My cases
          </h2>
          {(cases ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No cases raised yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {(cases ?? []).map((c: any) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/member/cases/${c.id}`}
                    className="truncate font-medium text-emerald-700 hover:underline"
                  >
                    {c.deceased_name}
                  </Link>
                  {statusBadge(c.status)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {/* Notifications preview */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Unread notifications
            </h2>
            <Link
              href="/member/notifications"
              className="text-sm font-semibold text-emerald-700 hover:underline"
            >
              View all
            </Link>
          </div>
          {(notifications ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">You are all caught up.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {(notifications ?? []).map((n: any) => (
                <li key={n.id} className="border-b pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                  {n.body && <p className="text-sm text-gray-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Leadership contacts */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Leadership contacts
            </h2>
            <Link
              href="/member/leadership"
              className="text-sm font-semibold text-emerald-700 hover:underline"
            >
              View all
            </Link>
          </div>
          {(leadership ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No contacts listed.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {(leadership ?? []).map((l: any) => (
                <li key={l.id}>
                  <p className="text-sm font-semibold text-gray-900">{l.name}</p>
                  <p className="text-sm text-gray-600">{l.role}</p>
                  <p className="text-xs text-gray-500">
                    {[l.phone, l.email].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
