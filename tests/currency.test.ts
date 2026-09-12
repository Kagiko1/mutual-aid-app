import { describe, it, expect } from 'vitest';
import { formatMoney, toMinor } from '@/lib/money';
import {
  getCurrency,
  currencySymbol,
  isSupportedCurrency,
  convertMinor,
  CURRENCIES,
} from '@/lib/currency';

describe('formatMoney (multi-currency)', () => {
  it("formatMoney(5000000, 'KES') contains '50,000.00'", () => {
    expect(formatMoney(5000000, 'KES')).toContain('50,000.00');
  });

  it('places symbol first and code last', () => {
    const out = formatMoney(5000000, 'KES');
    expect(out.startsWith('KSh ')).toBe(true);
    expect(out.endsWith(' KES')).toBe(true);
  });

  it('uses en-KE grouping: 1,234,567.89 for 123456789 minor', () => {
    expect(formatMoney(123456789, 'KES')).toContain('1,234,567.89');
  });

  it('formats USD with $ symbol', () => {
    const out = formatMoney(100000, 'USD');
    expect(out.startsWith('$ ')).toBe(true);
    expect(out).toContain('1,000.00');
    expect(out.endsWith(' USD')).toBe(true);
  });

  it('formats NGN with ₦ symbol', () => {
    const out = formatMoney(250000, 'NGN');
    expect(out.startsWith('₦ ')).toBe(true);
    expect(out.endsWith(' NGN')).toBe(true);
  });

  it('formats zero', () => {
    expect(formatMoney(0, 'KES')).toContain('0.00');
  });

  it('formats small amounts with two decimals', () => {
    expect(formatMoney(5, 'KES')).toContain('0.05');
    expect(formatMoney(99, 'EUR')).toContain('0.99');
  });

  it('defaults to KES when no code given', () => {
    const out = formatMoney(100000);
    expect(out).toContain('1,000.00');
    expect(out).toContain('KSh');
    expect(out).toContain('KES');
  });

  it('falls back to KES for unknown codes', () => {
    const out = formatMoney(100000, 'XXX');
    expect(out).toContain('KES');
  });
});

describe('toMinor', () => {
  it('toMinor(200.50) === 20050', () => {
    expect(toMinor(200.5)).toBe(20050);
  });

  it('rounds to the nearest cent', () => {
    expect(toMinor(10.005)).toBe(1001);
    expect(toMinor(10.004)).toBe(1000);
  });

  it('handles whole numbers, zero and negatives', () => {
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(0)).toBe(0);
    expect(toMinor(-25.25)).toBe(-2525);
  });

  it('round-trips with formatMoney', () => {
    expect(formatMoney(toMinor(1234.56), 'KES')).toContain('1,234.56');
  });
});

describe('currency registry', () => {
  it('covers the major African mobile-money currencies', () => {
    for (const code of ['KES', 'UGX', 'TZS', 'RWF', 'NGN', 'GHS', 'ZMW']) {
      expect(isSupportedCurrency(code)).toBe(true);
    }
  });

  it('getCurrency is case-insensitive', () => {
    expect(getCurrency('usd').code).toBe('USD');
    expect(currencySymbol('kes')).toBe('KSh');
  });

  it('registry entries have code, symbol and name', () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('convertMinor', () => {
  const rates = { KES: 129, USD: 1, UGX: 3720 };
  it('converts KES 129.00 → USD 1.00', () => {
    expect(convertMinor(12900, 'KES', 'USD', rates)).toBe(100);
  });
  it('converts USD 1.00 → UGX 3,720.00', () => {
    expect(convertMinor(100, 'USD', 'UGX', rates)).toBe(372000);
  });
  it('returns the amount unchanged for same currency', () => {
    expect(convertMinor(12345, 'KES', 'KES', rates)).toBe(12345);
  });
  it('throws when a rate is missing', () => {
    expect(() => convertMinor(100, 'KES', 'EUR', rates)).toThrow();
  });
});
