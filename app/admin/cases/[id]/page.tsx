import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOrgConfig, money, fmtDate, fmtDay } from '@/lib/admin/config';
import { Card, PageHeader, StatusPill, EmptyState } from '@/components/admin/ui';
import CaseActions from '@/components/admin/CaseActions';

interface CaseRow {
  id: string;
  member_id: string;
  case_type: string;
  deceased_name: string;
  death_date: string;
  deceased_member_id: string | null;
  deceased_dependent_id: string | null;
  paired_case_id: string | null;
  status: string;
  benefit_amount: number;
  admin_notes: string | null;
  created_by_admin: boolean;
  created_at: string;
  reviewed_at: string | null;
  approved_at: string | null;
  disbursed_at: string | null;
}

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const cfg = await getOrgConfig();
  const supabase = createClient();

  const { data: caseData } = await supabase.from('cases').select('*').eq('id', params.id).single();
  if (!caseData) notFound();
  const c = caseData as CaseRow;

  const [{ data: member }, { data: docs }, { data: checklist }, { data: voucher }, { data: disbursements }, { data: beneficiaries }] =
    await Promise.all([
      supabase.from('profiles').select('id, full_name, email, phone, national_id, status').eq('id', c.member_id).single(),
      supabase.from('case_documents').select('*').eq('case_id', c.id).order('created_at', { ascending: true }),
      supabase.from('claim_checklists').select('*').eq('case_type', c.case_type).maybeSingle(),
      supabase.from('vouchers').select('*').eq('case_id', c.id).maybeSingle(),
      supabase.from('disbursements').select('*').eq('case_id', c.id).order('created_at', { ascending: true }),
      supabase.from('beneficiaries').select('*').eq('member_id', c.member_id).order('created_at', { ascending: true }),
    ]);

  const { data: paired } = c.paired_case_id
    ? await supabase.from('cases').select('id, deceased_name, status').eq('id', c.paired_case_id).single()
    : { data: null };

  const m = member as { full_name: string; email: string | null; phone: string | null; national_id: string | null; status: string } | null;
  const docRows = (docs ?? []) as { id: string; doc_type: string; storage_path: string; created_at: string }[];
  const uploadedTypes = new Set(docRows.map((d) => d.doc_type.toLowerCase()));
  const requiredDocs = (((checklist as { required_docs?: unknown } | null)?.required_docs ?? []) as unknown[]).map(String);
  const missingDocs = requiredDocs.filter((d) => !uploadedTypes.has(d.toLowerCase()));
  const disbRows = (disbursements ?? []) as {
    id: string;
    beneficiary_name: string;
    amount: number;
    channel: string;
    mpesa_receipt: string | null;
    status: string;
  }[];
  const benRows = (beneficiaries ?? []) as { id: string; full_name: string; relationship: string | null; percentage: number }[];
  const v = voucher as { id: string; voucher_no: string; amount: number; pdf_storage_path: string | null; issued_at: string } | null;

  const doublePayoutFlag = Boolean(c.paired_case_id || c.deceased_member_id);

  return (
    <div>
      <PageHeader
        title={`Case: ${c.deceased_name}`}
        subtitle={`Filed ${fmtDate(c.created_at)}${c.created_by_admin ? ' · created by admin on behalf of member' : ''}`}
        actions={
          <Link href="/admin/cases" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Back to queue
          </Link>
        }
      />

      {doublePayoutFlag && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Double-payout flag</p>
          <p className="mt-1 text-sm text-amber-800">
            {c.paired_case_id
              ? `This case is paired with case ${(paired as { deceased_name?: string } | null)?.deceased_name ?? c.paired_case_id} — verify the same death is not being paid twice.`
              : 'The deceased is recorded as a member (deceased_member_id set) — confirm eligibility before disbursing.'}
          </p>
          {c.paired_case_id && (
            <Link href={`/admin/cases/${c.paired_case_id}`} className="mt-2 inline-block text-sm font-medium text-amber-900 underline">
              Open paired case
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Case details">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Claimant</dt>
                <dd className="font-medium text-slate-900">
                  <Link href={`/admin/members/${c.member_id}`} className="hover:underline">
                    {m?.full_name ?? '—'}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd><StatusPill status={c.status} /></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Case type</dt>
                <dd className="font-medium text-slate-900">{c.case_type}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Benefit amount</dt>
                <dd className="font-medium text-slate-900">{money(c.benefit_amount, cfg)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Date of death</dt>
                <dd className="font-medium text-slate-900">{fmtDay(c.death_date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Reviewed / Approved / Disbursed</dt>
                <dd className="font-medium text-slate-900">
                  {[c.reviewed_at && `rev ${fmtDay(c.reviewed_at)}`, c.approved_at && `appr ${fmtDay(c.approved_at)}`, c.disbursed_at && `disb ${fmtDay(c.disbursed_at)}`]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </dd>
              </div>
            </dl>
            {m && (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
                <p>
                  <span className="text-xs text-slate-500">Member contact: </span>
                  {[m.email, m.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="mt-1">
                  <span className="text-xs text-slate-500">National ID: </span>
                  {m.national_id ?? '—'} · <span className="text-xs text-slate-500">Member status: </span>
                  <StatusPill status={m.status} />
                </p>
              </div>
            )}
          </Card>

          <Card title="Documents vs required checklist">
            {requiredDocs.length === 0 && (
              <p className="mb-3 text-xs text-slate-500">
                No checklist configured for case type “{c.case_type}”.{' '}
                <Link href="/admin/checklists" className="font-medium underline">Configure checklists</Link>.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {requiredDocs.map((d) => {
                const ok = uploadedTypes.has(d.toLowerCase());
                return (
                  <li key={d} className="flex items-center justify-between py-2 text-sm">
                    <span className={ok ? 'text-slate-700' : 'font-medium text-slate-900'}>{d}</span>
                    {ok ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">uploaded</span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">missing</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {missingDocs.length > 0 && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                Missing documents: {missingDocs.join(', ')}
              </p>
            )}
            <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded documents</h4>
            {docRows.length === 0 ? (
              <EmptyState message="No documents uploaded yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {docRows.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">{d.doc_type}</span>
                    <span className="text-xs text-slate-400">{fmtDate(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(v || disbRows.length > 0) && (
            <Card title="Voucher & disbursement split">
              {v && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">Voucher {v.voucher_no}</p>
                    <p className="text-xs text-slate-500">Issued {fmtDate(v.issued_at)} · {money(v.amount, cfg)}</p>
                  </div>
                  <a
                    href={`/api/vouchers/${v.id}/pdf`}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    Download voucher PDF
                  </a>
                </div>
              )}
              {disbRows.length > 0 ? (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Beneficiary</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Amount</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Channel</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Receipt</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {disbRows.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{d.beneficiary_name}</td>
                        <td className="px-4 py-2 text-right">{money(d.amount, cfg)}</td>
                        <td className="px-4 py-2 text-slate-600">{d.channel}</td>
                        <td className="px-4 py-2 text-slate-600">{d.mpesa_receipt ?? '—'}</td>
                        <td className="px-4 py-2"><StatusPill status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState message="No disbursements recorded yet." />
              )}
            </Card>
          )}

          {benRows.length > 0 && disbRows.length === 0 && (
            <Card title="Expected beneficiary split">
              <ul className="divide-y divide-slate-100">
                {benRows.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">
                      {b.full_name}
                      {b.relationship ? <span className="text-xs text-slate-400"> · {b.relationship}</span> : null}
                    </span>
                    <span className="font-medium text-slate-900">
                      {Number(b.percentage).toFixed(2)}% · {money(Math.round((c.benefit_amount * Number(b.percentage)) / 100), cfg)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div>
          <CaseActions caseId={c.id} status={c.status} initialNotes={c.admin_notes ?? ''} />
        </div>
      </div>
    </div>
  );
}
