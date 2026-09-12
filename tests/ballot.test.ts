import { describe, it, expect } from 'vitest';
import { hashVote, tallyVotes } from '@/lib/engines/ballot';

describe('hashVote', () => {
  it('is deterministic: same inputs -> same 64-char hex hash', () => {
    const h1 = hashVote('voter-1', 'ballot-1', 'salt-abc');
    const h2 = hashVote('voter-1', 'ballot-1', 'salt-abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash for a different voter', () => {
    expect(hashVote('voter-1', 'ballot-1', 'salt-abc')).not.toBe(
      hashVote('voter-2', 'ballot-1', 'salt-abc'),
    );
  });

  it('produces a different hash for a different ballot', () => {
    expect(hashVote('voter-1', 'ballot-1', 'salt-abc')).not.toBe(
      hashVote('voter-1', 'ballot-2', 'salt-abc'),
    );
  });

  it('produces a different hash for a different salt', () => {
    expect(hashVote('voter-1', 'ballot-1', 'salt-abc')).not.toBe(
      hashVote('voter-1', 'ballot-1', 'salt-xyz'),
    );
  });

  it('throws on empty voterId, ballotId, or salt', () => {
    expect(() => hashVote('', 'ballot-1', 'salt-abc')).toThrow(/required/);
    expect(() => hashVote('voter-1', '', 'salt-abc')).toThrow(/required/);
    expect(() => hashVote('voter-1', 'ballot-1', '')).toThrow(/required/);
  });

  it('separates fields with delimiters so concatenation cannot collide', () => {
    // 'ab' + 'c' vs 'a' + 'bc' must not hash the same thanks to ':' separators
    expect(hashVote('ab', 'c', 's')).not.toBe(hashVote('a', 'bc', 's'));
  });
});

describe('tallyVotes', () => {
  const options = [
    { id: 'approve', label: 'Approve' },
    { id: 'reject', label: 'Reject' },
    { id: 'abstain', label: 'Abstain' },
  ];

  it('counts votes correctly', () => {
    const result = tallyVotes(
      [
        { optionId: 'approve' },
        { optionId: 'approve' },
        { optionId: 'reject' },
        { optionId: 'approve' },
      ],
      options,
    );
    expect(result).toEqual({ approve: 3, reject: 1, abstain: 0 });
  });

  it('includes every option with a 0 default, even with no votes', () => {
    expect(tallyVotes([], options)).toEqual({ approve: 0, reject: 0, abstain: 0 });
  });

  it('ignores votes for unknown optionIds', () => {
    const result = tallyVotes(
      [{ optionId: 'approve' }, { optionId: 'bogus' }, { optionId: 'approve' }],
      options,
    );
    expect(result).toEqual({ approve: 2, reject: 0, abstain: 0 });
    expect(result).not.toHaveProperty('bogus');
  });

  it('ignores unknown optionIds even when no valid votes exist', () => {
    expect(tallyVotes([{ optionId: 'ghost' }], options)).toEqual({
      approve: 0,
      reject: 0,
      abstain: 0,
    });
  });
});
