/**
 * Currency registry + money formatting.
 * Amounts are always integer MINOR units (cents) throughout the app.
 */
export interface Currency {
  code: string;
  symbol: string;
  name: string;
  locale: string;
  minorDigits: number;
}

export const CURRENCIES: Currency[] = [
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', locale: 'en-KE', minorDigits: 2 },
  { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', locale: 'en-UG', minorDigits: 2 },
  { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', locale: 'en-TZ', minorDigits: 2 },
  { code: 'RWF', symbol: 'RF', name: 'Rwandan Franc', locale: 'en-RW', minorDigits: 2 },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', locale: 'en-NG', minorDigits: 2 },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi', locale: 'en-GH', minorDigits: 2 },
  { code: 'ZMW', symbol: 'K', name: 'Zambian Kwacha', locale: 'en-ZM', minorDigits: 2 },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA', minorDigits: 2 },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US', minorDigits: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE', minorDigits: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB', minorDigits: 2 },
];

const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code?: string | null): Currency {
  return byCode.get((code || 'KES').toUpperCase()) ?? byCode.get('KES')!;
}

export function currencySymbol(code?: string | null): string {
  return getCurrency(code).symbol;
}

export function isSupportedCurrency(code: string): boolean {
  return byCode.has(code.toUpperCase());
}

/** Format integer minor units, e.g. formatMoney(5000000, 'KES') → "KSh 50,000.00 KES". */
export function formatMoney(amountMinor: number, currencyCode = 'KES'): string {
  const c = getCurrency(currencyCode);
  const major = (amountMinor ?? 0) / 100;
  const grouped = major.toLocaleString(c.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${c.symbol} ${grouped} ${c.code}`;
}

/** Major units → integer minor units. */
export function toMinor(major: number): number {
  return Math.round(major * 100);
}

/**
 * Convert minor units between currencies using USD-anchored rates
 * (usdRates maps currency code → units per 1 USD, e.g. { KES: 129 }).
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  usdRates: Record<string, number>,
): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amountMinor;
  const fromRate = usdRates[f];
  const toRate = usdRates[t];
  if (!fromRate || !toRate) throw new Error(`missing fx rate for ${f} or ${t}`);
  return Math.round((amountMinor / fromRate) * toRate);
}
