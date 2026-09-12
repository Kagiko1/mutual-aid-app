/**
 * waitingPeriod — new members must wait out the waiting period
 * (default 180 days, configurable via org_config) before raising a case.
 */

export function waitingEndsAt(joinedAt: Date | string, waitingDays: number): Date {
  const d = new Date(joinedAt);
  d.setDate(d.getDate() + waitingDays);
  return d;
}

export function waitingPeriodSatisfied(
  joinedAt: Date | string,
  waitingDays: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= waitingEndsAt(joinedAt, waitingDays).getTime();
}

export function waitingDaysRemaining(
  joinedAt: Date | string,
  waitingDays: number,
  now: Date = new Date(),
): number {
  const ms = waitingEndsAt(joinedAt, waitingDays).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
