/**
 * doublePayoutDetection — a deceased person who is BOTH a primary member
 * AND registered as a dependent under another member triggers paired cases.
 * Matching is done on national_id (the stable cross-record identifier).
 */

export interface DeceasedMember {
  id: string;
  nationalId: string | null;
  fullName: string;
}

export interface DependentRecord {
  id: string;
  memberId: string; // the member this dependent is registered under
  memberName: string;
  fullName: string;
  nationalId: string | null;
}

export interface DoublePayoutResult {
  isDoublePayout: boolean;
  /** The dependent record that matches the deceased member, if any. */
  matchedDependent?: DependentRecord;
  /** Human-readable explanation for the admin review queue. */
  reason?: string;
}

export function detectDoublePayout(
  deceased: DeceasedMember,
  allDependents: DependentRecord[],
): DoublePayoutResult {
  if (!deceased.nationalId) return { isDoublePayout: false };

  const matched = allDependents.find(
    (d) =>
      d.nationalId != null &&
      d.nationalId === deceased.nationalId &&
      d.memberId !== deceased.id, // not their own dependent listing
  );

  if (!matched) return { isDoublePayout: false };

  return {
    isDoublePayout: true,
    matchedDependent: matched,
    reason:
      `${deceased.fullName} is a primary member and is also registered as a dependent ` +
      `under ${matched.memberName}. Two linked cases must be opened and benefits reconciled.`,
  };
}
