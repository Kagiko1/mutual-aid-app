import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { signOut } from './actions';
import AdminNav from '@/components/admin/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const admin = createAdminClient();
  const { isSuperAdmin } = await resolveOrgContext(admin);

  let orgs: { slug: string; name: string }[] = [];
  let currentOrgSlug: string | null = null;
  if (isSuperAdmin) {
    const { data } = await admin.from('organizations').select('slug, name').order('name');
    orgs = ((data ?? []) as { slug: string; name: string }[]);
    currentOrgSlug = cookies().get('view_org')?.value ?? null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              MA
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Mutual Aid Admin</p>
              <p className="text-xs text-slate-500">Administration console</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{session.fullName}</p>
              <p className="text-xs text-slate-500">{session.email}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <aside className="w-52 shrink-0">
          <div className="sticky top-6">
            <AdminNav isSuperAdmin={isSuperAdmin} orgs={orgs} currentOrgSlug={currentOrgSlug} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
