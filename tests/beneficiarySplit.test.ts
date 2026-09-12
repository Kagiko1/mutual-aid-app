import { describe, it, expect } from 'vitest';
import { splitBeneficiaries, validatePercentages } from '@/lib/engines/beneficiarySplit';

const sum = (rows: { amountMinor: number }[]) =>
  rows.reduce((a, r) => a + r.amountMinor, 0);

describe('splitBeneficiaries', () => {
  it('splits 5000000 minor 60/40 exactly', () => {
    const result = splitBeneficiaries(5000000, [
      { id: 'b1', percentage: 60 },
      { id: 'b2', percentage: 40 },
    ]);
    expect(result).toEqual([
      { beneficiaryId: 'b1', amountMinor: 3000000 },
      { beneficiaryId: 'b2', amountMinor: 2000000 },
    ]);
  });

  it('distributes the leftover cent by largest remainder (33.33/33.33/33.34 of 100)', () => {
    // 33.33 -> 33.33, 33.33 -> 33.33, 33.34 -> 33.34
    // floored: 33 + 33 + 33 = 99, leftover 1 goes to the largest fractional part (33.34)
    const result = splitBeneficiaries(100, [
      { id: 'a', percentage: 33.33 },
      { id: 'b', percentage: 33.33 },
      { id: 'c', percentage: 33.34 },
    ]);
    expect(sum(result)).toBe(100);
    const byId = Object.fromEntries(result.map((r) => [r.beneficiaryId, r.amountMinor]));
    expect(byId.c).toBe(34);
    expect(byId.a + byId.b).toBe(66);
    expect(byId.a).toBe(33);
    expect(byId.b).toBe(33);
  });

  it('handles a single 100% beneficiary', () => {
    const result = splitBeneficiaries(12345, [{ id: 'only', percentage: 100 }]);
    expect(result).toEqual([{ beneficiaryId: 'only', amountMinor: 12345 }]);
  });

  it('gives every leftover cent to exactly one beneficiary per unit (ties broken deterministically)', () => {
    // 3 equal shares of 100: fractions are all 0.33... -> leftover 1
    const result = splitBeneficiaries(100, [
      { id: 'x', percentage: 33.3333 },
      { id: 'y', percentage: 33.3333 },
      { id: 'z', percentage: 33.3334 },
    ]);
    expect(sum(result)).toBe(100);
    const amounts = result.map((r) => r.amountMinor).sort((p, q) => p - q);
    expect(amounts).toEqual([33, 33, 34]);
  });

  it('handles a zero total', () => {
    const result = splitBeneficiaries(0, [
      { id: 'a', percentage: 50 },
      { id: 'b', percentage: 50 },
    ]);
    expect(result).toEqual([
      { beneficiaryId: 'a', amountMinor: 0 },
      { beneficiaryId: 'b', amountMinor: 0 },
    ]);
  });

  it('preserves input order in the result', () => {
    const result = splitBeneficiaries(1000, [
      { id: 'second', percentage: 30 },
      { id: 'first', percentage: 70 },
    ]);
    expect(result[0].beneficiaryId).toBe('second');
    expect(result[1].beneficiaryId).toBe('first');
  });

  it('allocations always sum exactly to totalMinor (property-style over many percentage sets)', () => {
    const totals = [1, 7, 99, 100, 101, 12345, 5000000, 99999999];
    const shareSets: number[][] = [
      [100],
      [50, 50],
      [33.33, 33.33, 33.34],
      [25, 25, 25, 25],
      [10, 20, 30, 40],
      [1, 99],
      [0.5, 99.5],
      [12.34, 56.78, 30.88],
      [20, 20, 20, 20, 20],
      [33.333, 33.333, 33.334],
    ];
    // randomized percentage sets: cut 100 into n random parts, renormalized to sum 100
    for (let seed = 0; seed < 30; seed++) {
      const n = 2 + (seed % 5);
      const cuts = Array.from({ length: n }, (_, i) => ((seed * 7919 + i * 104729) % 997) + 1);
      const cutSum = cuts.reduce((a, c) => a + c, 0);
      shareSets.push(cuts.map((c) => (c / cutSum) * 100));
    }
    for (const total of totals) {
      for (const shares of shareSets) {
        const ids = shares.map((_, i) => `b${i}`);
        const result = splitBeneficiaries(
          total,
          shares.map((percentage, i) => ({ id: ids[i], percentage })),
        );
        expect(sum(result)).toBe(total);
        expect(result.length).toBe(shares.length);
        for (const r of result) {
          expect(Number.isInteger(r.amountMinor)).toBe(true);
          expect(r.amountMinor).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('rejects non-integer or negative totals', () => {
    expect(() => splitBeneficiaries(-1, [{ id: 'a', percentage: 100 }])).toThrow();
    expect(() => splitBeneficiaries(10.5, [{ id: 'a', percentage: 100 }])).toThrow();
  });
});

describe('validatePercentages', () => {
  it('accepts percentages that sum to 100', () => {
    expect(() => validatePercentages([{ id: 'a', percentage: 100 }])).not.toThrow();
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: 60 },
        { id: 'b', percentage: 40 },
      ]),
    ).not.toThrow();
  });

  it('throws when the sum is clearly outside tolerance (e.g. 99.98)', () => {
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: 50 },
        { id: 'b', percentage: 49.98 },
      ]),
    ).toThrow(/sum to 100/);
  });

  it('accepts a sum within the 0.01 tolerance', () => {
    // note: 50 + 49.99 is 99.99000000000001 in float, i.e. within tolerance
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: 50 },
        { id: 'b', percentage: 49.99 },
      ]),
    ).not.toThrow();
  });

  it('throws when the sum is 100.02 (beyond tolerance)', () => {
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: 50 },
        { id: 'b', percentage: 50.02 },
      ]),
    ).toThrow(/sum to 100/);
  });

  it('throws on an empty share list', () => {
    expect(() => validatePercentages([])).toThrow(/At least one beneficiary/);
  });

  it('throws on a 0% share', () => {
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: 0 },
        { id: 'b', percentage: 100 },
      ]),
    ).toThrow(/Invalid percentage/);
  });

  it('throws on a negative share', () => {
    expect(() =>
      validatePercentages([
        { id: 'a', percentage: -10 },
        { id: 'b', percentage: 110 },
      ]),
    ).toThrow(/Invalid percentage/);
  });

  it('throws on a share above 100%', () => {
    expect(() => validatePercentages([{ id: 'a', percentage: 100.01 }])).toThrow(
      /Invalid percentage/,
    );
  });

  it('throws on NaN percentage', () => {
    expect(() => validatePercentages([{ id: 'a', percentage: NaN }])).toThrow(
      /Invalid percentage/,
    );
  });

  it('splitBeneficiaries propagates percentage validation errors', () => {
    expect(() => splitBeneficiaries(1000, [])).toThrow(/At least one beneficiary/);
    expect(() => splitBeneficiaries(1000, [{ id: 'a', percentage: 90 }])).toThrow(/sum to 100/);
  });
});
