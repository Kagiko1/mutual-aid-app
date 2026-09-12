/**
 * PATCH /api/admin/dependents/[depId]
 * Body: { verification_status: 'verified' | 'rejected' }
 *
 * Admin verifies/rejects a dependent; stamps verified_by/verified_at and
 * notifies the owning member.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';

export async function PATCH(request: NextRequest, { params }: { params: { depId: string } }) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    const body = await request.json().catch(() => ({}));
    const { verification_status } = body as { verification_status?: string };

    if (!['verified', 'rejected'].includes(verification_status ?? '')) {
      return Response.json(
        { error: "verification_status must be 'verified' or 'rejected'" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { data: dependent, error } = await admin
      .from('dependents')
      .update({
        verification_status,
        verified_by: profile.id,
        verified_at: now,
      })
      .eq('id', params.depId)
      .eq('org_id', ctx.orgId)
      .select()
      .single();
    if (error || !dependent) {
      return Response.json({ error: 'dependent not found', message: error?.message }, { status: 404 });
    }

    await notifyMember(admin, {
      memberId: dependent.member_id,
      title: `Dependent ${verification_status}`,
      body: `${dependent.full_name} has been ${verification_status} by the admin.`,
      type: 'dependent',
      orgId: ctx.orgId,
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: `dependent_${verification_status}`,
      entity: 'dependent',
      entityId: dependent.id,
      details: { member_id: dependent.member_id },
      orgId: ctx.orgId,
    });

    return Response.json({ dependent });
  } catch (e) {
    return handleGuardError(e);
  }
}
