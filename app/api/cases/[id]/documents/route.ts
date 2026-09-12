/**
 * POST /api/cases/[id]/documents
 * Multipart form: { docType: string, file: File }
 *
 * The case owner (or any admin) may upload supporting documents at any time.
 * Stored in the private `claim-docs` bucket under {caseId}/{timestamp}_{filename},
 * with a row in case_documents.
 */
import { NextRequest } from 'next/server';
import { requireMember, handleGuardError } from '@/lib/guard';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireMember(request);
    const { userId, profile, admin } = ctx;

    const { data: theCase } = await admin.from('cases').select('id, member_id').eq('id', params.id).eq('org_id', ctx.orgId).single();
    if (!theCase) return Response.json({ error: 'case not found' }, { status: 404 });
    if (profile.role !== 'admin' && theCase.member_id !== userId) {
      return Response.json({ error: 'forbidden', message: 'Not your case' }, { status: 403 });
    }

    const form = await request.formData();
    const docType = form.get('docType');
    const file = form.get('file');
    if (typeof docType !== 'string' || !docType) {
      return Response.json({ error: 'docType is required' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return Response.json({ error: 'file is required' }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${params.id}/${Date.now()}_${safeName}`;
    const { error: uploadErr } = await admin.storage
      .from('claim-docs')
      .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (uploadErr) {
      return Response.json({ error: 'upload failed', message: uploadErr.message }, { status: 500 });
    }

    const { data: doc, error: docErr } = await admin
      .from('case_documents')
      .insert({
        org_id: ctx.orgId,
        case_id: params.id,
        doc_type: docType,
        storage_path: storagePath,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (docErr || !doc) {
      return Response.json({ error: 'failed to record document', message: docErr?.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: userId,
      action: 'case_document_uploaded',
      entity: 'case_document',
      entityId: doc.id,
      orgId: ctx.orgId,
      details: { caseId: params.id, docType, storagePath },
    });

    return Response.json({ document: doc }, { status: 201 });
  } catch (e) {
    return handleGuardError(e);
  }
}
