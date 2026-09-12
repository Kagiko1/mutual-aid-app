import { describe, it, expect } from 'vitest';
import {
  waitingEndsAt,
  waitingPeriodSatisfied,
  waitingDaysRemaining,
} from '@/lib/engines/waitingPeriod';

const daysAgo = (n: number, now = new Date()) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe('waitingEndsAt', () => {
  it('adds waitingDays to the join date', () => {
    const ends = waitingEndsAt('2026-01-01T00:00:00Z', 180);
    expect(ends.getTime()).toBe(new Date('2026-06-30T00:00:00Z').getTime());
  });

  it('accepts Date objects', () => {
    const ends = waitingEndsAt(new Date('2026-01-01T00:00:00Z'), 90);
    expect(ends.getTime()).toBe(new Date('2026-04-01T00:00:00Z').getTime());
  });
});

describe('waitingPeriodSatisfied (180-day default)', () => {
  it('is satisfied when joined 200 days ago', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingPeriodSatisfied(daysAgo(200, now), 180, now)).toBe(true);
  });

  it('is not satisfied when joined 10 days ago', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingPeriodSatisfied(daysAgo(10, now), 180, now)).toBe(false);
  });

  it('boundary: exactly at the waiting end -> satisfied', () => {
    const joined = new Date('2026-03-15T00:00:00Z');
    const atEnd = waitingEndsAt(joined, 180);
    expect(waitingPeriodSatisfied(joined, 180, atEnd)).toBe(true);
  });

  it('one millisecond before the waiting end -> not satisfied', () => {
    const joined = new Date('2026-03-15T00:00:00Z');
    const atEnd = waitingEndsAt(joined, 180);
    expect(waitingPeriodSatisfied(joined, 180, new Date(atEnd.getTime() - 1))).toBe(false);
  });
});

describe('waitingPeriodSatisfied — custom waiting days', () => {
  it('90-day waiting period', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingPeriodSatisfied(daysAgo(100, now), 90, now)).toBe(true);
    expect(waitingPeriodSatisfied(daysAgo(10, now), 90, now)).toBe(false);
  });

  it('zero waiting days is immediately satisfied', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingPeriodSatisfied(now, 0, now)).toBe(true);
  });
});

describe('waitingDaysRemaining', () => {
  it('≈ 170 days remaining when joined 10 days ago with 180-day wait', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    const remaining = waitingDaysRemaining(daysAgo(10, now), 180, now);
    expect(remaining).toBe(170);
  });

  it('is 0 once satisfied', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingDaysRemaining(daysAgo(200, now), 180, now)).toBe(0);
  });

  it('rounds partial days up (ceils)', () => {
    const joined = new Date('2026-09-01T12:00:00Z');
    // ends 2026-10-01T12:00:00Z; 12h before that -> 0.5 days -> ceil to 1
    const now = new Date('2026-10-01T00:00:00Z');
    expect(waitingDaysRemaining(joined, 30, now)).toBe(1);
  });

  it('respects custom waiting days', () => {
    const now = new Date('2026-09-11T12:00:00Z');
    expect(waitingDaysRemaining(daysAgo(10, now), 90, now)).toBe(80);
  });
});
