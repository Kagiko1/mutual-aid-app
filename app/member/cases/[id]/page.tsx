import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { getOrgConfig } from '@/lib/admin/config';
import { formatMoney } from '@/lib/money';
import { uploadCaseDocument } from './actions';

const TIMELINE = ['pending_review', 'reviewed', 'approved', 'disbursed'] as const;

function statusStyle(status: string) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    pending_review: 'bg-yellow-100 text-yellow-800',
    reviewed: 'bg-blue-100 text-blue-800',
    approved: 'bg-emerald-100 text-emerald-800',
    disbursed: 'bg-emerald-200 text-emerald-900',
    rejected: 'bg-red-100 text-red-800',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-700';
}

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { orgId, profile: ctxProfile } = await resolveOrgContext(admin);

  const cfg = await getOrgConfig(orgId);

  const { data: c } = await admin
    .from('cases')
    .select('id, member_id, case_type, deceased_name, death_date, status, benefit_amount, admin_notes, created_at')
    .eq('id', params.id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (!c || c.member_id !== ctxProfile.id) notFound();

  const { data: documents } = await admin
    .from('case_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('case_id', c.id)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  const showAdminNotes = ['reviewed', 'approved', 'disbursed'].includes(c.status);
  const uploadsOpen = ['pending_review', 'reviewed'].includes(c.status);
  const timelineIndex = c.status === 'rejected' ? -1 : TIMELINE.indexOf(c.status as any);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/member" className="text-sm font-semibold text-emerald-700 hover:underline">
        Back to dashboard
      </Link>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{c.deceased_name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              Case type: <span className="capitalize">{c.case_type}</span> · Incident date:{' '}
              {new Date(c.death_date).toLocaleDateString()} · Filed:{' '}
              {new Date(c.created_at).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyle(c.status)}`}
          >
            {c.status.replace(/_/g, ' ')}
          </span>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          Benefit amount:{' '}
          <strong className="text-gray-900">
            {formatMoney(Number(c.benefit_amount), cfg.currency_code)}
          </strong>
        </p>

        {/* Status timeline */}
        {c.status !== 'rejected' ? (
          <ol className="mt-6 flex flex-wrap items-center gap-2">
            {TIMELINE.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                    i <= timelineIndex ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {stage.replace(/_/g, ' ')}
                </span>
                {i < TIMELINE.length - 1 && <span className="text-gray-300">—</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            This case was rejected. Please contact leadership for details.
          </p>
        )}

        {showAdminNotes && c.admin_notes && (
          <div className="mt-6 rounded-md bg-blue-50 p-4">
            <h2 className="text-sm font-semibold text-blue-900">Reviewer notes</h2>
            <p className="mt-1 text-sm text-blue-900">{c.admin_notes}</p>
          </div>
        )}
      </div>

      {/* Documents */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
        {(documents ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No documents uploaded yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {(documents ?? []).map((d: any) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium text-gray-800">{d.doc_type.replace(/_/g, ' ')}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(d.created_at).toLocaleString()}
                  </span>
                </span>
                <span className="text-xs text-gray-500">{d.storage_path.split('/').pop()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Post-submission upload */}
      {uploadsOpen && (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Upload additional document</h2>
          <p className="mt-1 text-sm text-gray-600">
            You can add supporting documents while your case is under review.
          </p>
          <form action={uploadCaseDocument} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="caseId" value={c.id} />
            <div>
              <label htmlFor="docType" className="block text-sm font-medium text-gray-700">
                Document type
              </label>
              <input
                id="docType"
                name="docType"
                className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                placeholder="e.g. burial_permit"
              />
            </div>
            <div>
              <label htmlFor="file" className="block text-sm font-medium text-gray-700">
                File
              </label>
              <input id="file" name="file" type="file" accept="image/*,.pdf" required className="mt-1 text-sm" />
            </div>
            <button
              type="submit"
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Upload
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
