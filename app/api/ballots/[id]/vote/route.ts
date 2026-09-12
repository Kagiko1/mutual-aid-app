/**
 * POST /api/ballots/[id]/vote
 * Body: { optionId: string }
 *
 * Any authenticated member may vote on an OPEN ballot. Voter identity is never
 * stored — only SHA-256(voterId:ballotId:salt). The unique (ballot_id, voter_hash)
 * constraint enforces one vote per member; a conflict returns 409.
 */
import { NextRequest } from 'next/server';
import { requireMember, handleGuardError } from '@/lib/guard';
import { hashVote } from '@/lib/engines/ballot';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireMember(request);
    const { userId, admin } = ctx;
    const body = await request.json().catch(() => ({}));
    const { optionId } = body as { optionId?: string };
    if (!optionId) return Response.json({ error: 'optionId is required' }, { status: 400 });

    const { data: ballot } = await admin
      .from('ballots')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', ctx.orgId)
      .single();
    if (!ballot) return Response.json({ error: 'ballot not found' }, { status: 404 });
    if (ballot.status !== 'open') {
      return Response.json(
        { error: 'ballot_not_open', message: `Ballot is ${ballot.status}` },
        { status: 400 },
      );
    }
    const options = (ballot.options ?? []) as { id: string; label: string }[];
    if (!options.some((o) => o.id === optionId)) {
      return Response.json({ error: 'invalid optionId for this ballot' }, { status: 400 });
    }

    const salt = process.env.BALLOT_SALT;
    if (!salt) return Response.json({ error: 'BALLOT_SALT is not configured' }, { status: 500 });
    const voterHash = hashVote(userId, params.id, salt);

    const { error } = await admin.from('votes').insert({
      org_id: ctx.orgId,
      ballot_id: params.id,
      voter_hash: voterHash,
      option_id: optionId,
    });
    if (error) {
      if (error.code === '23505') {
        return Response.json({ error: 'already_voted', message: 'You have already voted on this ballot' }, { status: 409 });
      }
      return Response.json({ error: 'failed to record vote', message: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return handleGuardError(e);
  }
}
