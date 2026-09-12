import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { requireAdmin } from '@/lib/admin/guard';
import { Card, PageHeader, EmptyState, inputCls, btnPrimary, btnDanger } from '@/components/admin/ui';

export default async function ChecklistsPage() {
  const admin = createAdminClient();
  const { orgId } = await resolveOrgContext(admin);

  const parseDocs = (raw: unknown): string[] =>
    String((raw as string | null) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  async function createChecklist(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    const case_type = String(formData.get('case_type') || '').trim().toLowerCase();
    if (!case_type) return;
    await admin.from('claim_checklists').upsert(
      { org_id: orgId, case_type, required_docs: parseDocs(formData.get('required_docs')) },
      { onConflict: 'case_type' },
    );
    revalidatePath('/admin/checklists');
  }

  async function updateChecklist(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin
      .from('claim_checklists')
      .update({ required_docs: parseDocs(formData.get('required_docs')) })
      .eq('org_id', orgId)
      .eq('id', String(formData.get('id')));
    revalidatePath('/admin/checklists');
  }

  async function deleteChecklist(formData: FormData) {
    'use server';
    await requireAdmin();
    const admin = createAdminClient();
    await admin.from('claim_checklists').delete().eq('org_id', orgId).eq('id', String(formData.get('id')));
    revalidatePath('/admin/checklists');
  }

  const { data: lists } = await admin.from('claim_checklists').select('*').eq('org_id', orgId).order('case_type');
  const rows = (lists ?? []) as { id: string; case_type: string; required_docs: unknown }[];

  return (
    <div>
      <PageHeader
        title="Claim checklists"
        subtitle="Required documents per case type. Case review compares these against uploaded documents."
      />

      <Card title="New / replace checklist" className="mb-6 max-w-2xl">
        <form action={createChecklist} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Case type *</label>
            <input name="case_type" required className={inputCls} placeholder="e.g. death, medical, other" />
            <p className="mt-1 text-xs text-slate-400">Saving with an existing case type replaces its checklist.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Required documents (comma-separated)</label>
            <input
              name="required_docs"
              className={inputCls}
              placeholder="e.g. death certificate, national ID, burial permit"
            />
          </div>
          <button type="submit" className={btnPrimary}>Save checklist</button>
        </form>
      </Card>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Case type</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Required documents</th>
              <th className="px-4 py-3 text-right font-medium text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const docs = ((r.required_docs ?? []) as unknown[]).map(String);
              return (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.case_type}</td>
                  <td className="px-4 py-3">
                    <form action={updateChecklist} className="flex gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="required_docs" defaultValue={docs.join(', ')} className={inputCls} />
                      <button type="submit" className={btnPrimary}>Save</button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={deleteChecklist}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className={btnDanger}>Delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState message="No checklists configured yet." />}
      </div>
    </div>
  );
}
