import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { fmtDate } from '@/lib/admin/config';
import { Card, PageHeader, StatusPill } from '@/components/admin/ui';
import CertifyBallot from '@/components/admin/CertifyBallot';

interface BallotRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  options: { id: string; label: string }[];
  certified_at: string | null;
  results: unknown;
  created_at: string;
}

export default async function BallotDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);

  async function closeBallot() {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('ballots').update({ status: 'closed' }).eq('org_id', orgId).eq('id', params.id);
    revalidatePath(`/admin/ballots/${params.id}`);
  }

  const { data: ballot } = await admin.from('ballots').select('*').eq('org_id', orgId).eq('id', params.id).single();
  if (!ballot) notFound();
  const b = ballot as BallotRow;
  const options = (b.options ?? []) as { id: string; label: string }[];

  const { count: voteCount } = await admin.from('votes').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('ballot_id', b.id);

  const labelOf = new Map(options.map((o) => [o.id, o.label]));
  // results may be an object {optionId: votes} or an array [{option_id, votes}]
  let resultRows: { optionId: string; votes: number }[] = [];
  if (Array.isArray(b.results)) {
    resultRows = (b.results as { option_id?: string; votes?: number }[]).map((r) => ({
      optionId: String(r.option_id ?? ''),
      votes: Number(r.votes ?? 0),
    }));
  } else if (b.results && typeof b.results === 'object') {
    resultRows = Object.entries(b.results as Record<string, number>).map(([optionId, votes]) => ({
      optionId,
      votes: Number(votes ?? 0),
    }));
  }
  resultRows.sort((a, z) => z.votes - a.votes);
  const totalVotes = resultRows.reduce((s, r) => s + r.votes, 0);

  return (
    <div>
      <PageHeader
        title={b.title}
        subtitle={b.description ?? `Created ${fmtDate(b.created_at)}`}
        actions={
          <Link href="/admin/ballots" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Back to ballots
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Ballot status">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd><StatusPill status={b.status} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Votes cast</dt>
              <dd className="font-semibold text-slate-900">{voteCount ?? 0}</dd>
            </div>
            {b.certified_at && (
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Certified at</dt>
                <dd className="font-medium text-slate-900">{fmtDate(b.certified_at)}</dd>
              </div>
            )}
          </dl>

          {b.status === 'certified' ? (
            <div className="mt-6">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Certified results</h4>
              {resultRows.length === 0 ? (
                <p className="text-sm text-slate-400">No results recorded on the ballot.</p>
              ) : (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Option</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Votes</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resultRows.map((r) => (
                      <tr key={r.optionId}>
                        <td className="px-4 py-2 font-medium text-slate-900">{labelOf.get(r.optionId) ?? r.optionId}</td>
                        <td className="px-4 py-2 text-right">{r.votes}</td>
                        <td className="px-4 py-2 text-right text-slate-500">
                          {totalVotes > 0 ? `${((r.votes / totalVotes) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-700">{voteCount ?? 0} votes cast</p>
              <p className="mt-0.5 text-xs text-slate-500">Per-option tallies stay hidden until the ballot is certified.</p>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Options">
            <ul className="divide-y divide-slate-100">
              {options.map((o) => (
                <li key={o.id} className="py-2 text-sm text-slate-800">
                  {o.label} <span className="text-xs text-slate-400">({o.id})</span>
                </li>
              ))}
            </ul>
            {options.length === 0 && <p className="text-sm text-slate-400">No options defined.</p>}
          </Card>

          {b.status !== 'certified' && (
            <Card title="Certify results">
              <CertifyBallot ballotId={b.id} />
            </Card>
          )}

          {b.status === 'open' && (
            <Card title="Close voting">
              <p className="mb-3 text-sm text-slate-600">
                Close the ballot to stop further votes before certifying.
              </p>
              <form action={closeBallot}>
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close ballot
                </button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
