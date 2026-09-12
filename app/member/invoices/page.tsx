import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgConfig } from '@/lib/orgConfig';
import { formatMoney } from '@/lib/money';
import PayButton from '@/components/member/PayButton';

const FILTERS = ['all', 'pending', 'overdue', 'paid', 'waived'] as const;

function statusStyle(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    overdue: 'bg-red-100 text-red-800',
    paid: 'bg-emerald-100 text-emerald-800',
    waived: 'bg-gray-100 text-gray-600',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-700';
}

function paymentStatusStyle(status: string) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    pending: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-700';
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const cfg = await getOrgConfig(supabase);
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, phone, status')
    .eq('id', user.id)
    .maybeSingle();

  const activeFilter = FILTERS.includes(searchParams.status as any)
    ? (searchParams.status as string)
    : 'all';

  let query = supabase
    .from('invoices')
    .select('id, amount, status, due_date, paid_at, cases!inner(deceased_name)')
    .eq('member_id', user.id)
    .order('due_date', { ascending: true });
  if (activeFilter !== 'all') query = query.eq('status', activeFilter);
  const { data: invoices } = await query;

  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, channel, mpesa_receipt, status, paid_at, created_at')
    .eq('member_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My invoices</h1>
        <p className="mt-1 text-sm text-gray-600">
          Case contributions billed to you. Pay promptly to keep your membership active.
        </p>
      </div>

      {profile?.status === 'ineligible' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <strong>Reactivation notice:</strong> your membership is ineligible due to unpaid
          invoices. Pay your outstanding invoices below to reactivate your account.
        </div>
      )}

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? '/member/invoices' : `/member/invoices?status=${f}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              activeFilter === f ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      {/* Invoice list */}
      <div className="space-y-4">
        {(invoices ?? []).length === 0 ? (
          <p className="rounded-xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
            No invoices found for this filter.
          </p>
        ) : (
          (invoices ?? []).map((inv: any) => (
            <div key={inv.id} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {formatMoney(Number(inv.amount), cfg.currencySymbol, cfg.currencyCode)}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Case: {(inv.cases as any)?.deceased_name ?? '—'} · Due:{' '}
                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                    {inv.paid_at && ` · Paid ${new Date(inv.paid_at).toLocaleDateString()}`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyle(inv.status)}`}
                >
                  {inv.status}
                </span>
              </div>
              {(inv.status === 'pending' || inv.status === 'overdue') && (
                <div className="mt-4">
                  <PayButton invoiceId={inv.id} defaultPhone={profile?.phone ?? ''} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Payment history</h2>
        {(payments ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No payments recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(payments ?? []).map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(p.paid_at ?? p.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatMoney(Number(p.amount), cfg.currencySymbol, cfg.currencyCode)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.channel}</td>
                    <td className="px-4 py-3 text-gray-600">{p.mpesa_receipt ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${paymentStatusStyle(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
