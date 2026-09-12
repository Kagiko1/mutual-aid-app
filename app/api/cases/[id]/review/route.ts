/**
 * POST /api/cases/[id]/review
 * Body: { decision: 'reviewed' | 'request_corrections' | 'rejected', notes?: string }
 *
 * Admin review of a case:
 *   reviewed            -> status 'reviewed', reviewed_at set
 *   request_corrections -> status 'pending_review' (sent back), admin_notes set
 *   rejected            -> status 'rejected', admin_notes set
 * The member is notified with the admin's notes.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { logAudit } from '@/lib/audit';
import { notifyMember } from '@/lib/notify';

const DECISIONS = ['reviewed', 'request_corrections', 'rejected'] as const;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    const body = await request.json().catch(() => ({}));
    const { decision, notes } = body as { decision?: string; notes?: string };

    if (!decision || !DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      return Response.json(
        { error: `decision must be one of: ${DECISIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const { data: theCase } = await admin.from('cases').select('*').eq('id', params.id).eq('org_id', ctx.orgId).single();
    if (!theCase) return Response.json({ error: 'case not found' }, { status: 404 });

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { admin_notes: notes ?? theCase.admin_notes };
    if (decision === 'reviewed') {
      patch.status = 'reviewed';
      patch.reviewed_at = now;
    } else if (decision === 'request_corrections') {
      patch.status = 'pending_review';
    } else {
      patch.status = 'rejected';
    }

    const { data: updated, error } = await admin
      .from('cases')
      .update(patch)
      .eq('id', params.id)
      .eq('org_id', ctx.orgId)
      .select()
      .single();
    if (error) {
      return Response.json({ error: 'failed to update case', message: error.message }, { status: 500 });
    }

    const titles: Record<string, string> = {
      reviewed: 'Your case has been reviewed',
      request_corrections: 'Corrections needed on your case',
      rejected: 'Your case was rejected',
    };
    await notifyMember(admin, {
      memberId: theCase.member_id,
      title: titles[decision],
      body: notes ? `Admin notes: ${notes}` : undefined,
      type: 'case',
      orgId: ctx.orgId,
    });

    await logAudit(admin, {
      actorId: profile.id,
      action: `case_${decision}`,
      entity: 'case',
      entityId: params.id,
      orgId: ctx.orgId,
      details: { notes: notes ?? null },
    });

    return Response.json({ case: updated });
  } catch (e) {
    return handleGuardError(e);
  }
}
