/**
 * dripScheduler — contribution collection drip for a case invoice.
 * T+0 = case approval / invoice issue date.
 *   T+4  -> reminder
 *   T+6  -> final notice
 *   T+7  -> penalty applied + member marked ineligible
 * Days are counted as whole calendar days elapsed since issue.
 */

export type DripAction = 'none' | 'reminder' | 'final_notice' | 'penalty_ineligible';

export const DRIP = {
  REMINDER_DAY: 4,
  FINAL_NOTICE_DAY: 6,
  PENALTY_DAY: 7,
} as const;

export function daysSince(issuedAt: Date, now: Date = new Date()): number {
  const ms = now.getTime() - issuedAt.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function dripActionForDaysElapsed(days: number): DripAction {
  if (days >= DRIP.PENALTY_DAY) return 'penalty_ineligible';
  if (days >= DRIP.FINAL_NOTICE_DAY) return 'final_notice';
  if (days >= DRIP.REMINDER_DAY) return 'reminder';
  return 'none';
}

export function dripActionFor(issuedAt: Date | string, now: Date = new Date()): DripAction {
  return dripActionForDaysElapsed(daysSince(new Date(issuedAt), now));
}
