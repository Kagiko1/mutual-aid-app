import { createClient } from '@/lib/supabase/server';
import BallotVoteForm from '@/components/member/BallotVoteForm';

function statusStyle(status: string) {
  const styles: Record<string, string> = {
    open: 'bg-emerald-100 text-emerald-800',
    closed: 'bg-yellow-100 text-yellow-800',
    certified: 'bg-blue-100 text-blue-800',
    draft: 'bg-gray-100 text-gray-600',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-700';
}

export default async function BallotsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: ballots } = await supabase
    .from('ballots')
    .select('id, title, description, status, options, results, created_at')
    .in('status', ['open', 'closed', 'certified'])
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Ballots</h1>
      <p className="mt-1 text-sm text-gray-600">
        Cast your vote on open ballots. Voting is anonymous — your identity is never linked to your
        choice.
      </p>

      {(ballots ?? []).length === 0 ? (
        <p className="mt-6 rounded-xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          There are no ballots at the moment.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {(ballots ?? []).map((b: any) => {
            const options = Array.isArray(b.options) ? b.options : [];
            return (
              <div key={b.id} className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-gray-900">{b.title}</h2>
                    {b.description && (
                      <p className="mt-1 text-sm text-gray-600">{b.description}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyle(b.status)}`}
                  >
                    {b.status}
                  </span>
                </div>

                {b.status === 'open' && options.length > 0 && (
                  <BallotVoteForm
                    ballotId={b.id}
                    options={options.map((o: any) => ({ id: String(o.id), label: String(o.label) }))}
                  />
                )}

                {b.status === 'certified' && (
                  <div className="mt-4 rounded-md bg-blue-50 p-4">
                    <h3 className="text-sm font-semibold text-blue-900">Certified results</h3>
                    {b.results ? (
                      <ul className="mt-2 space-y-1 text-sm text-blue-900">
                        {Object.entries(b.results as Record<string, unknown>).map(([k, v]) => (
                          <li key={k} className="flex justify-between">
                            <span>{k}</span>
                            <span className="font-semibold">{String(v)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-blue-900">Results were not published.</p>
                    )}
                  </div>
                )}

                {b.status === 'closed' && (
                  <p className="mt-4 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-600">
                    Voting is closed. Results hidden until certified.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
