import { describe, it, expect } from 'vitest';
import { computeCaseInvoices } from '@/lib/engines/invoicing';

const memberIds = (n: number) => Array.from({ length: n }, (_, i) => `member-${i + 1}`);

describe('computeCaseInvoices — flat strategy', () => {
  it('invoices 10 members × 20000 minor against a 5000000 benefit → total 200000, surplus 0', () => {
    const result = computeCaseInvoices({
      strategy: 'flat',
      flatFeeMinor: 20000,
      benefitAmountMinor: 5000000,
      memberIds: memberIds(10),
    });
    expect(result.invoices).toHaveLength(10);
    for (const inv of result.invoices) {
      expect(inv.amountMinor).toBe(20000);
    }
    expect(result.totalInvoicedMinor).toBe(200000);
    // 200000 - 5000000 < 0 -> surplus clamped to 0
    expect(result.surplusToReserveMinor).toBe(0);
  });

  it('300 members × 20000 = 6000000 vs benefit 5000000 → surplus 1000000', () => {
    const result = computeCaseInvoices({
      strategy: 'flat',
      flatFeeMinor: 20000,
      benefitAmountMinor: 5000000,
      memberIds: memberIds(300),
    });
    expect(result.totalInvoicedMinor).toBe(6000000);
    expect(result.surplusToReserveMinor).toBe(1000000);
  });

  it('keeps memberId mapping one-to-one', () => {
    const ids = ['a', 'b', 'c'];
    const result = computeCaseInvoices({
      strategy: 'flat',
      flatFeeMinor: 150,
      benefitAmountMinor: 10000,
      memberIds: ids,
    });
    expect(result.invoices.map((i) => i.memberId)).toEqual(ids);
  });
});

describe('computeCaseInvoices — proportional strategy', () => {
  it('splits 5000000 across 3 members: sums exactly, differs by ≤ 1', () => {
    const result = computeCaseInvoices({
      strategy: 'proportional',
      flatFeeMinor: 0,
      benefitAmountMinor: 5000000,
      memberIds: memberIds(3),
    });
    expect(result.invoices).toHaveLength(3);
    const total = result.invoices.reduce((a, i) => a + i.amountMinor, 0);
    expect(total).toBe(5000000);
    const amounts = result.invoices.map((i) => i.amountMinor);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
    // 5000000 / 3 = 1666666.67 -> 1666667 + 1666667 + 1666666
    expect(amounts).toEqual([1666667, 1666667, 1666666]);
  });

  it('surplus is always 0 for proportional', () => {
    for (const [benefit, n] of [
      [5000000, 3],
      [100, 3],
      [1, 7],
      [999999, 1000],
    ] as const) {
      const result = computeCaseInvoices({
        strategy: 'proportional',
        flatFeeMinor: 0,
        benefitAmountMinor: benefit,
        memberIds: memberIds(n),
      });
      expect(result.surplusToReserveMinor).toBe(0);
      expect(result.totalInvoicedMinor).toBe(benefit);
    }
  });

  it('handles a single member', () => {
    const result = computeCaseInvoices({
      strategy: 'proportional',
      flatFeeMinor: 0,
      benefitAmountMinor: 777,
      memberIds: ['solo'],
    });
    expect(result.invoices).toEqual([{ memberId: 'solo', amountMinor: 777 }]);
  });
});

describe('computeCaseInvoices — validation', () => {
  it('throws on empty memberIds', () => {
    expect(() =>
      computeCaseInvoices({
        strategy: 'flat',
        flatFeeMinor: 20000,
        benefitAmountMinor: 5000000,
        memberIds: [],
      }),
    ).toThrow(/No active members/);
    expect(() =>
      computeCaseInvoices({
        strategy: 'proportional',
        flatFeeMinor: 0,
        benefitAmountMinor: 5000000,
        memberIds: [],
      }),
    ).toThrow(/No active members/);
  });

  it('throws on invalid fee/benefit amounts', () => {
    expect(() =>
      computeCaseInvoices({
        strategy: 'flat',
        flatFeeMinor: -1,
        benefitAmountMinor: 5000000,
        memberIds: ['a'],
      }),
    ).toThrow(/Invalid/);
    expect(() =>
      computeCaseInvoices({
        strategy: 'flat',
        flatFeeMinor: 20000,
        benefitAmountMinor: 0,
        memberIds: ['a'],
      }),
    ).toThrow(/Invalid/);
  });
});
