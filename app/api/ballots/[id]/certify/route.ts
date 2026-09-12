/**
 * POST /api/ballots/[id]/certify
 * Body: {} (no fields required)
 *
 * Admin-only, TOTP-gated. The ballot must already be 'closed'. Tallies the
 * anonymous votes and writes the results to the ballot, moving it to 'certified'.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, checkTotp, handleGuardError } from '@/lib/guard';
import { tallyVotes } from '@/lib/engines/ballot';
import { logAudit } from '@/lib/audit';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAdmin(request);
    const { profile, admin } = ctx;
    checkTotp(request, profile);

    const { data: ballot } = await admin
      .from('ballots')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', ctx.orgId)
      .single();
    if (!ballot) return Response.json({ error: 'ballot not found' }, { status: 404 });
    if (ballot.status !== 'closed') {
      return Response.json(
        { error: 'ballot_not_closed', message: `Ballot is ${ballot.status}; close it before certifying` },
        { status: 400 },
      );
    }

    const { data: votes } = await admin.from('votes').select('option_id').eq('ballot_id', params.id);
    const options = (ballot.options ?? []) as { id: string; label: string }[];
    const results = tallyVotes(
      ((votes ?? []) as { option_id: string }[]).map((v) => ({ optionId: v.option_id })),
      options,
    );

    const now = new Date().toISOString();
    const { data: updated, error } = await admin
      .from('ballots')
      .update({ status: 'certified', certified_at: now, results })
      .eq('id', params.id)
      .eq('org_id', ctx.orgId)
      .select()
      .single();
    if (error) {
      return Response.json({ error: 'failed to certify ballot', message: error.message }, { status: 500 });
    }

    await logAudit(admin, {
      actorId: profile.id,
      action: 'ballot_certified',
      entity: 'ballot',
      entityId: params.id,
      details: { results, totalVotes: (votes ?? []).length },
      orgId: ctx.orgId,
    });

    return Response.json({ ballot: updated, results });
  } catch (e) {
    return handleGuardError(e);
  }
}
