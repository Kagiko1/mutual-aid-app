import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/guard';
import { Card, PageHeader, EmptyState, inputCls, btnPrimary, btnDanger } from '@/components/admin/ui';

export default async function LeadershipPage() {
  const supabase = createClient();

  async function createContact(formData: FormData) {
    'use server';
    await requireAdmin();
    const supabase = createClient();
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    await supabase.from('leadership_contacts').insert({
      name,
      role: String(formData.get('role') || '').trim(),
      phone: String(formData.get('phone') || '').trim() || null,
      email: String(formData.get('email') || '').trim() || null,
    });
    revalidatePath('/admin/leadership');
  }

  async function deleteContact(formData: FormData) {
    'use server';
    await requireAdmin();
    const supabase = createClient();
    await supabase.from('leadership_contacts').delete().eq('id', String(formData.get('id')));
    revalidatePath('/admin/leadership');
  }

  const { data: contacts } = await supabase.from('leadership_contacts').select('*').order('created_at', { ascending: true });
  const rows = (contacts ?? []) as { id: string; name: string; role: string; phone: string | null; email: string | null }[];

  return (
    <div>
      <PageHeader title="Leadership" subtitle="Committee and leadership contact directory." />

      <Card title="Add contact" className="mb-6 max-w-2xl">
        <form action={createContact} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Name *</label>
            <input name="name" required className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Role *</label>
            <input name="role" required className={inputCls} placeholder="e.g. Chairperson" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Phone</label>
            <input name="phone" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
            <input name="email" type="email" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={btnPrimary}>Add contact</button>
          </div>
        </form>
      </Card>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Email</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.role}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <form action={deleteContact}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className={btnDanger}>Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState message="No leadership contacts yet." />}
      </div>
    </div>
  );
}
