import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { fmtDate } from '@/lib/admin/config';
import { Card, PageHeader, StatusPill, EmptyState } from '@/components/admin/ui';
import BallotCreateForm from '@/components/admin/BallotCreateForm';

export default async function BallotsPage() {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);

  async function createBallot(formData: FormData) {
    'use server';
    const session = await requireAdmin();
    const admin = createAdminClient();
    const title = String(formData.get('title') || '').trim();
    if (!title) return;
    let labels: string[] = [];
    try {
      labels = JSON.parse(String(formData.get('options') || '[]'));
    } catch {
      labels = [];
    }
    const options = labels
      .map((l) => String(l).trim())
      .filter(Boolean)
      .map((label, i) => ({ id: `opt-${i + 1}`, label }));
    if (options.length < 2) return;
    await admin.from('ballots').insert({
      org_id: orgId,
      title,
      description: String(formData.get('description') || '').trim() || null,
      status: 'draft',
      options,
      created_by: session.userId,
    });
    revalidatePath('/admin/ballots');
  }

  async function setStatus(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin
      .from('ballots')
      .update({ status: String(formData.get('status')) })
      .eq('org_id', orgId)
      .eq('id', String(formData.get('id')));
    revalidatePath('/admin/ballots');
  }

  async function deleteBallot(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('ballots').delete().eq('org_id', orgId).eq('id', String(formData.get('id')));
    revalidatePath('/admin/ballots');
  }

  const { data: ballots } = await admin.from('ballots').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  const ballotRows = (ballots ?? []) as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    created_at: string;
    certified_at: string | null;
  }[];

  const { data: votes } = ballotRows.length
    ? await admin.from('votes').select('ballot_id').eq('org_id', orgId).in('ballot_id', ballotRows.map((b) => b.id))
    : { data: [] };
  const voteCount = new Map<string, number>();
  for (const v of ((votes ?? []) as { ballot_id: string }[])) {
    voteCount.set(v.ballot_id, (voteCount.get(v.ballot_id) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader title="Ballots" subtitle="Governance votes. Results stay hidden until certified." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Create ballot" className="xl:col-span-1">
          <BallotCreateForm createBallot={createBallot} />
        </Card>

        <div className="xl:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Votes</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Created</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ballotRows.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/ballots/${b.id}`} className="font-medium text-slate-900 hover:underline">
                        {b.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={b.status} /></td>
                    <td className="px-4 py-3 text-slate-600">
                      {b.status === 'certified' ? voteCount.get(b.id) ?? 0 : `${voteCount.get(b.id) ?? 0} cast`}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(b.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {b.status === 'draft' && (
                          <form action={setStatus}>
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="status" value="open" />
                            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                              Open
                            </button>
                          </form>
                        )}
                        {b.status === 'open' && (
                          <form action={setStatus}>
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="status" value="closed" />
                            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                              Close
                            </button>
                          </form>
                        )}
                        {(b.status === 'draft') && (
                          <form action={deleteBallot}>
                            <input type="hidden" name="id" value={b.id} />
                            <button type="submit" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                              Delete
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ballotRows.length === 0 && <EmptyState message="No ballots yet." />}
          </div>
        </div>
      </div>
    </div>
  );
}
