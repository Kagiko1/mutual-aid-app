import { describe, it, expect } from 'vitest';
import {
  detectDoublePayout,
  type DeceasedMember,
  type DependentRecord,
} from '@/lib/engines/doublePayout';

const deceased: DeceasedMember = {
  id: 'member-1',
  nationalId: 'NAT-12345',
  fullName: 'Amina Yusuf',
};

const dependentOfOtherMember: DependentRecord = {
  id: 'dep-9',
  memberId: 'member-2',
  memberName: 'Brian Otieno',
  fullName: 'Amina Yusuf',
  nationalId: 'NAT-12345',
};

describe('detectDoublePayout', () => {
  it('detects when the deceased nationalId matches a dependent under a DIFFERENT member', () => {
    const result = detectDoublePayout(deceased, [dependentOfOtherMember]);
    expect(result.isDoublePayout).toBe(true);
    expect(result.matchedDependent).toBe(dependentOfOtherMember);
    expect(result.reason).toContain('Amina Yusuf');
    expect(result.reason).toContain('Brian Otieno');
  });

  it('finds the match among unrelated dependents', () => {
    const others: DependentRecord[] = [
      { id: 'dep-1', memberId: 'member-7', memberName: 'Carol', fullName: 'X', nationalId: 'NAT-1' },
      { id: 'dep-2', memberId: 'member-8', memberName: 'Dan', fullName: 'Y', nationalId: null },
    ];
    const result = detectDoublePayout(deceased, [...others, dependentOfOtherMember]);
    expect(result.isDoublePayout).toBe(true);
    expect(result.matchedDependent?.id).toBe('dep-9');
  });

  it('returns false when no dependent matches', () => {
    const result = detectDoublePayout(deceased, [
      {
        id: 'dep-1',
        memberId: 'member-7',
        memberName: 'Carol',
        fullName: 'Zoe',
        nationalId: 'NAT-99999',
      },
    ]);
    expect(result).toEqual({ isDoublePayout: false });
  });

  it('returns false when there are no dependents at all', () => {
    expect(detectDoublePayout(deceased, [])).toEqual({ isDoublePayout: false });
  });

  it('ignores a dependent listed under the deceased’s own memberId', () => {
    const ownDependent: DependentRecord = {
      id: 'dep-own',
      memberId: 'member-1', // same as deceased.id
      memberName: 'Amina Yusuf',
      fullName: 'Junior Yusuf',
      nationalId: 'NAT-12345',
    };
    const result = detectDoublePayout(deceased, [ownDependent]);
    expect(result).toEqual({ isDoublePayout: false });
  });

  it('still detects when both an own-listing and a foreign listing exist', () => {
    const ownDependent: DependentRecord = {
      id: 'dep-own',
      memberId: 'member-1',
      memberName: 'Amina Yusuf',
      fullName: 'Junior Yusuf',
      nationalId: 'NAT-12345',
    };
    const result = detectDoublePayout(deceased, [ownDependent, dependentOfOtherMember]);
    expect(result.isDoublePayout).toBe(true);
    expect(result.matchedDependent?.id).toBe('dep-9');
  });

  it('returns false when the deceased has a null nationalId', () => {
    const noId: DeceasedMember = { id: 'member-1', nationalId: null, fullName: 'Amina Yusuf' };
    const result = detectDoublePayout(noId, [dependentOfOtherMember]);
    expect(result).toEqual({ isDoublePayout: false });
  });

  it('returns false when the deceased has an empty nationalId', () => {
    const emptyId: DeceasedMember = { id: 'member-1', nationalId: '', fullName: 'Amina Yusuf' };
    const result = detectDoublePayout(emptyId, [dependentOfOtherMember]);
    expect(result).toEqual({ isDoublePayout: false });
  });

  it('does not match on name alone when nationalIds differ', () => {
    const nameOnly: DependentRecord = {
      ...dependentOfOtherMember,
      nationalId: 'NAT-DIFFERENT',
    };
    const result = detectDoublePayout(deceased, [nameOnly]);
    expect(result).toEqual({ isDoublePayout: false });
  });

  it('skips dependents with null nationalId even if everything else matches', () => {
    const nullId: DependentRecord = { ...dependentOfOtherMember, nationalId: null };
    const result = detectDoublePayout(deceased, [nullId]);
    expect(result).toEqual({ isDoublePayout: false });
  });
});
