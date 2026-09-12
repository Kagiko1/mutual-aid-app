'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const UPLOADABLE_STATUSES = ['pending_review', 'reviewed'];

export async function uploadCaseDocument(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const caseId = formData.get('caseId');
  const docType = (formData.get('docType') as string) || 'supporting_document';
  const file = formData.get('file');

  if (typeof caseId !== 'string' || !caseId) throw new Error('Missing case id.');
  if (!(file instanceof File) || file.size === 0) throw new Error('Please choose a file to upload.');

  const { data: c } = await supabase
    .from('cases')
    .select('id, member_id, status')
    .eq('id', caseId)
    .maybeSingle();
  if (!c || c.member_id !== user.id) throw new Error('Case not found.');
  if (!UPLOADABLE_STATUSES.includes(c.status)) {
    throw new Error('Additional documents can only be added while the case is under review.');
  }

  const path = `${caseId}/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from('claim-docs').upload(path, file, {
    contentType: file.type,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await supabase.from('case_documents').insert({
    case_id: caseId,
    doc_type: docType,
    storage_path: path,
    uploaded_by: user.id,
  });
  if (insErr) throw new Error(insErr.message);

  redirect(`/member/cases/${caseId}`);
}
