import { createClient } from '@/lib/supabase/server';

export default async function LeadershipPage() {
  const supabase = createClient();
  const { data: contacts } = await supabase
    .from('leadership_contacts')
    .select('id, name, role, phone, email')
    .order('created_at', { ascending: true });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Leadership contacts</h1>
      <p className="mt-1 text-sm text-gray-600">
        Reach out to the elected leadership for help with membership, claims, or contributions.
      </p>

      {(contacts ?? []).length === 0 ? (
        <p className="mt-6 rounded-xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          No leadership contacts listed.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(contacts ?? []).map((c: any) => (
            <div key={c.id} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-800">
                {String(c.name ?? '?').charAt(0).toUpperCase()}
              </div>
              <h2 className="mt-3 font-semibold text-gray-900">{c.name}</h2>
              <p className="text-sm text-emerald-700">{c.role}</p>
              <dl className="mt-3 space-y-1 text-sm text-gray-600">
                {c.phone && (
                  <div className="flex gap-2">
                    <dt className="font-medium text-gray-500">Phone</dt>
                    <dd>
                      <a href={`tel:${c.phone}`} className="hover:underline">
                        {c.phone}
                      </a>
                    </dd>
                  </div>
                )}
                {c.email && (
                  <div className="flex gap-2">
                    <dt className="font-medium text-gray-500">Email</dt>
                    <dd>
                      <a href={`mailto:${c.email}`} className="hover:underline">
                        {c.email}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
