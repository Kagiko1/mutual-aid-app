import { describe, it, expect } from 'vitest';
import { formatMoney, toMinor } from '@/lib/money';

describe('formatMoney', () => {
  it("formatMoney(5000000, 'KSh', 'KES') contains '50,000.00'", () => {
    const out = formatMoney(5000000, 'KSh', 'KES');
    expect(out).toContain('50,000.00');
  });

  it('places symbol first and code last', () => {
    const out = formatMoney(5000000, 'KSh', 'KES');
    expect(out.startsWith('KSh ')).toBe(true);
    expect(out.endsWith(' KES')).toBe(true);
  });

  it('uses en-KE grouping: 1,234,567.89 for 123456789 minor', () => {
    expect(formatMoney(123456789, 'KSh', 'KES')).toContain('1,234,567.89');
  });

  it('formats zero', () => {
    expect(formatMoney(0, 'KSh', 'KES')).toContain('0.00');
  });

  it('formats small amounts with two decimals', () => {
    expect(formatMoney(5, 'KSh', 'KES')).toContain('0.05');
    expect(formatMoney(99, 'KSh', 'KES')).toContain('0.99');
  });

  it('defaults to KSh / KES when not provided', () => {
    const out = formatMoney(100000);
    expect(out).toContain('1,000.00');
    expect(out).toContain('KSh');
    expect(out).toContain('KES');
  });
});

describe('toMinor', () => {
  it('toMinor(200.50) === 20050', () => {
    expect(toMinor(200.5)).toBe(20050);
  });

  it('rounds to the nearest cent', () => {
    expect(toMinor(10.005)).toBe(1001); // 1000.5 -> round half up
    expect(toMinor(10.004)).toBe(1000);
    expect(toMinor(10.015)).toBe(1002);
  });

  it('handles whole numbers and zero', () => {
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(0)).toBe(0);
  });

  it('handles negative amounts', () => {
    expect(toMinor(-25.25)).toBe(-2525);
  });

  it('round-trips with formatMoney', () => {
    const out = formatMoney(toMinor(1234.56), 'KSh', 'KES');
    expect(out).toContain('1,234.56');
  });
});
