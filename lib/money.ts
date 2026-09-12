/** Money helpers — amounts are integers in minor units (cents). */
export function formatMoney(amountMinor: number, symbol = 'KSh', code = 'KES'): string {
  const major = (amountMinor / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${major} ${code}`;
}

export function toMinor(major: number): number {
  return Math.round(major * 100);
}
