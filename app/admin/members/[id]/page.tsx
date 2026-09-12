import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { getOrgConfig, money, fmtDate, fmtDay } from '@/lib/admin/config';
import { Card, PageHeader, StatusPill, EmptyState, inputCls, btnPrimary } from '@/components/admin/ui';
import DependentActions from '@/components/admin/DependentActions';

export default async function MemberDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);
  const cfg = await getOrgConfig(orgId);
  const id = params.id;

  async function setStatus(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('profiles').update({ status: String(formData.get('status')) }).eq('org_id', orgId).eq('id', id);
    revalidatePath(`/admin/members/${id}`);
  }

  async function reviewKyc(formData: FormData) {
    'use server';
    const session = await requireAdmin();
    const admin = createAdminClient();
    await admin
      .from('kyc_docs')
      .update({ status: String(formData.get('status')), reviewed_by: session.userId })
      .eq('org_id', orgId)
      .eq('id', String(formData.get('id')));
    revalidatePath(`/admin/members/${id}`);
  }

  const { data: profile } = await admin.from('profiles').select('*').eq('org_id', orgId).eq('id', id).single();
  if (!profile) notFound();
  const p = profile as {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    national_id: string | null;
    role: string;
    status: string;
    joined_at: string;
    waiting_ends_at: string | null;
    totp_enabled: boolean;
  };

  const [{ data: dependents }, { data: beneficiaries }, { data: kycDocs }, { data: cases }, { data: invoices }, { data: payments }] =
    await Promise.all([
      admin.from('dependents').select('*').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: true }),
      admin.from('beneficiaries').select('*').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: true }),
      admin.from('kyc_docs').select('*').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: false }),
      admin.from('cases').select('id, deceased_name, case_type, benefit_amount, status, created_at').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: false }),
      admin.from('invoices').select('*').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: false }),
      admin.from('payments').select('*').eq('org_id', orgId).eq('member_id', id).order('created_at', { ascending: false }),
    ]);

  const depRows = (dependents ?? []) as {
    id: string;
    full_name: string;
    kinship_type: string;
    date_of_birth: string | null;
    national_id: string | null;
    verification_status: string;
    verified_at: string | null;
  }[];
  const benRows = (beneficiaries ?? []) as { id: string; full_name: string; relationship: string | null; percentage: number; phone: string | null }[];
  const kycRows = (kycDocs ?? []) as { id: string; doc_type: string; storage_path: string; status: string; created_at: string }[];
  const caseRows = (cases ?? []) as { id: string; deceased_name: string; case_type: string; benefit_amount: number; status: string; created_at: string }[];
  const invRows = (invoices ?? []) as { id: string; amount: number; status: string; strategy: string | null; due_date: string | null; paid_at: string | null; case_id: string }[];
  const payRows = (payments ?? []) as { id: string; amount: number; channel: string; mpesa_receipt: string | null; status: string; paid_at: string | null }[];
  const benTotal = benRows.reduce((s, b) => s + Number(b.percentage), 0);

  return (
    <div>
      <PageHeader
        title={p.full_name}
        subtitle={`${p.role} · joined ${fmtDay(p.joined_at)}`}
        actions={
          <Link href="/admin/members" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Back to members
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Profile">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-xs text-slate-500">Email</dt><dd className="font-medium text-slate-900">{p.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Phone</dt><dd className="font-medium text-slate-900">{p.phone ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">National ID</dt><dd className="font-medium text-slate-900">{p.national_id ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">2FA (TOTP)</dt><dd className="font-medium text-slate-900">{p.totp_enabled ? 'Enabled' : 'Not enabled'}</dd></div>
              <div><dt className="text-xs text-slate-500">Waiting period ends</dt><dd className="font-medium text-slate-900">{fmtDay(p.waiting_ends_at)}</dd></div>
              <div><dt className="text-xs text-slate-500">Status</dt><dd><StatusPill status={p.status} /></dd></div>
            </dl>
            <form action={setStatus} className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Set status</label>
                <select name="status" defaultValue={p.status} className={inputCls}>
                  <option value="pending">pending</option>
                  <option value="active">active</option>
                  <option value="ineligible">ineligible</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <button type="submit" className={btnPrimary}>Update</button>
            </form>
          </Card>

          <Card title="Dependents — verification workflow">
            {depRows.length === 0 ? (
              <EmptyState message="No dependents registered." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {depRows.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{d.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {d.kinship_type}
                        {d.date_of_birth ? ` · born ${fmtDay(d.date_of_birth)}` : ''}
                        {d.national_id ? ` · ID ${d.national_id}` : ''}
                        {d.verified_at ? ` · verified ${fmtDay(d.verified_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusPill status={d.verification_status} />
                      {d.verification_status === 'pending' && <DependentActions depId={d.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Beneficiaries">
            {benRows.length === 0 ? (
              <EmptyState message="No beneficiaries nominated." />
            ) : (
              <>
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Relationship</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {benRows.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{b.full_name}</td>
                        <td className="px-4 py-2 text-slate-600">{b.relationship ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">{Number(b.percentage).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={`mt-2 text-xs ${Math.abs(benTotal - 100) < 0.01 ? 'text-slate-500' : 'font-medium text-red-600'}`}>
                  Total: {benTotal.toFixed(2)}% {Math.abs(benTotal - 100) >= 0.01 && '(must sum to 100%)'}
                </p>
              </>
            )}
          </Card>

          <Card title="KYC documents">
            {kycRows.length === 0 ? (
              <EmptyState message="No KYC documents uploaded." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {kycRows.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{d.doc_type}</p>
                      <p className="text-xs text-slate-400">{d.storage_path} · {fmtDate(d.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={d.status} />
                      {d.status === 'pending' && (
                        <>
                          <form action={reviewKyc}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="status" value="approved" />
                            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                              Approve
                            </button>
                          </form>
                          <form action={reviewKyc}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <button type="submit" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                              Reject
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Cases">
            {caseRows.length === 0 ? (
              <EmptyState message="No cases filed by this member." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {caseRows.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <Link href={`/admin/cases/${c.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                      {c.deceased_name}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <StatusPill status={c.status} /> {money(c.benefit_amount, cfg)} · {fmtDay(c.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Invoices">
            {invRows.length === 0 ? (
              <EmptyState message="No invoices." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {invRows.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{money(i.amount, cfg)}</p>
                      <p className="text-xs text-slate-500">
                        {i.strategy ?? '—'} · due {fmtDay(i.due_date)}
                        {i.paid_at ? ` · paid ${fmtDay(i.paid_at)}` : ''}
                      </p>
                    </div>
                    <StatusPill status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Payments">
            {payRows.length === 0 ? (
              <EmptyState message="No payments." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {payRows.map((pay) => (
                  <li key={pay.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{money(pay.amount, cfg)}</p>
                      <p className="text-xs text-slate-500">
                        {pay.channel}
                        {pay.mpesa_receipt ? ` · ${pay.mpesa_receipt}` : ''}
                        {pay.paid_at ? ` · ${fmtDay(pay.paid_at)}` : ''}
                      </p>
                    </div>
                    <StatusPill status={pay.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
