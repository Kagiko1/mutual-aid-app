/**
 * ballot — anonymous voting. Voter identity is never stored; instead we store
 * SHA-256(voterId + ':' + ballotId + ':' + serverSalt). One vote per hash
 * (unique constraint on (ballot_id, voter_hash)). Results stay hidden until
 * the ballot is certified.
 */
import { createHash } from 'crypto';

export function hashVote(voterId: string, ballotId: string, salt: string): string {
  if (!voterId || !ballotId || !salt) throw new Error('voterId, ballotId and salt are required');
  return createHash('sha256').update(`${voterId}:${ballotId}:${salt}`).digest('hex');
}

export interface BallotOption {
  id: string;
  label: string;
}

export function tallyVotes(
  votes: { optionId: string }[],
  options: BallotOption[],
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const o of options) tally[o.id] = 0;
  for (const v of votes) {
    if (v.optionId in tally) tally[v.optionId] += 1;
    // unknown option ids are ignored (defensive)
  }
  return tally;
}
