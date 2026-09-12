/**
 * DELETE /api/admin/payments/[id] — disconnect a processor config.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { logAudit } from '@/lib/audit';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAdmin(request);
    const { admin } = ctx;
    const { data: row } = await admin
      .from('org_payment_processors')
      .select('id, processor, environment')
      .eq('id', params.id)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });

    const { error } = await admin.from('org_payment_processors').delete().eq('id', params.id);
    if (error) throw error;

    await logAudit(admin, {
      actorId: ctx.profile.id,
      action: 'payment_processor_disconnected',
      entity: 'payment_processor',
      entityId: params.id,
      orgId: ctx.orgId,
      details: { processor: (row as { processor: string }).processor },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return handleGuardError(e);
  }
}
