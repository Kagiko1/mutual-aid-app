'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';

const UPLOADABLE_STATUSES = ['pending_review', 'reviewed'];

export async function uploadCaseDocument(formData: FormData) {
  const admin = createAdminClient();
  const { orgId, profile } = await resolveOrgContext(admin);

  const caseId = formData.get('caseId');
  const docType = (formData.get('docType') as string) || 'supporting_document';
  const file = formData.get('file');

  if (typeof caseId !== 'string' || !caseId) throw new Error('Missing case id.');
  if (!(file instanceof File) || file.size === 0) throw new Error('Please choose a file to upload.');

  const { data: c } = await admin
    .from('cases')
    .select('id, member_id, status')
    .eq('id', caseId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!c || c.member_id !== profile.id) throw new Error('Case not found.');
  if (!UPLOADABLE_STATUSES.includes(c.status)) {
    throw new Error('Additional documents can only be added while the case is under review.');
  }

  const path = `${caseId}/${Date.now()}-${file.name}`;
  const { error: upErr } = await admin.storage.from('claim-docs').upload(path, file, {
    contentType: file.type,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await admin.from('case_documents').insert({
    org_id: orgId,
    case_id: caseId,
    doc_type: docType,
    storage_path: path,
    uploaded_by: profile.id,
  });
  if (insErr) throw new Error(insErr.message);

  redirect(`/member/cases/${caseId}`);
}
