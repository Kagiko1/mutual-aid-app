/**
 * beneficiarySplit — fractional disbursement across beneficiaries.
 * Money is handled in MINOR units (integer cents) to avoid float errors.
 * Percentages must sum to 100 (within 0.01 tolerance).
 * Remainder cents from flooring are distributed by largest-remainder method.
 */

export interface BeneficiaryShare {
  id: string;
  percentage: number; // e.g. 60.0 for 60%
}

export interface Allocation {
  beneficiaryId: string;
  amountMinor: number;
}

const TOLERANCE = 0.01;

export function validatePercentages(shares: BeneficiaryShare[]): void {
  if (shares.length === 0) throw new Error('At least one beneficiary is required');
  for (const s of shares) {
    if (!(s.percentage > 0) || s.percentage > 100) {
      throw new Error(`Invalid percentage ${s.percentage} for beneficiary ${s.id}`);
    }
  }
  const sum = shares.reduce((a, s) => a + s.percentage, 0);
  if (Math.abs(sum - 100) > TOLERANCE) {
    throw new Error(`Beneficiary percentages must sum to 100 (got ${sum.toFixed(2)})`);
  }
}

export function splitBeneficiaries(totalMinor: number, shares: BeneficiaryShare[]): Allocation[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) {
    throw new Error('totalMinor must be a non-negative integer');
  }
  validatePercentages(shares);

  // Floor each exact share, track fractional remainders
  const rows = shares.map((s) => {
    const exact = (totalMinor * s.percentage) / 100;
    const floored = Math.floor(exact);
    return { id: s.id, floored, remainder: exact - floored };
  });

  let distributed = rows.reduce((a, r) => a + r.floored, 0);
  let leftover = totalMinor - distributed;

  // Largest-remainder: give one extra cent to the biggest fractional parts
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : 1));
  const bonus: Record<string, number> = {};
  for (const r of order) {
    if (leftover <= 0) break;
    bonus[r.id] = (bonus[r.id] ?? 0) + 1;
    leftover -= 1;
  }

  return rows.map((r) => ({
    beneficiaryId: r.id,
    amountMinor: r.floored + (bonus[r.id] ?? 0),
  }));
}
