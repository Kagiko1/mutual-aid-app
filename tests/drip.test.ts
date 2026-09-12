import { describe, it, expect } from 'vitest';
import {
  DRIP,
  daysSince,
  dripActionForDaysElapsed,
  dripActionFor,
} from '@/lib/engines/drip';

describe('dripActionForDaysElapsed', () => {
  it('returns none for days 0-3', () => {
    for (const day of [0, 1, 2, 3]) {
      expect(dripActionForDaysElapsed(day)).toBe('none');
    }
  });

  it('returns reminder for days 4-5', () => {
    expect(dripActionForDaysElapsed(4)).toBe('reminder');
    expect(dripActionForDaysElapsed(5)).toBe('reminder');
  });

  it('returns final_notice for day 6', () => {
    expect(dripActionForDaysElapsed(6)).toBe('final_notice');
  });

  it('returns penalty_ineligible for day 7 and beyond', () => {
    expect(dripActionForDaysElapsed(7)).toBe('penalty_ineligible');
    expect(dripActionForDaysElapsed(8)).toBe('penalty_ineligible');
    expect(dripActionForDaysElapsed(30)).toBe('penalty_ineligible');
    expect(dripActionForDaysElapsed(365)).toBe('penalty_ineligible');
  });

  it('uses the documented DRIP day boundaries', () => {
    expect(DRIP.REMINDER_DAY).toBe(4);
    expect(DRIP.FINAL_NOTICE_DAY).toBe(6);
    expect(DRIP.PENALTY_DAY).toBe(7);
    expect(dripActionForDaysElapsed(DRIP.REMINDER_DAY)).toBe('reminder');
    expect(dripActionForDaysElapsed(DRIP.FINAL_NOTICE_DAY)).toBe('final_notice');
    expect(dripActionForDaysElapsed(DRIP.PENALTY_DAY)).toBe('penalty_ineligible');
    expect(dripActionForDaysElapsed(DRIP.REMINDER_DAY - 1)).toBe('none');
  });
});

describe('daysSince', () => {
  it('floors partial days (23h59m -> 0 days)', () => {
    const issued = new Date('2026-09-01T00:00:00Z');
    const now = new Date('2026-09-01T23:59:00Z');
    expect(daysSince(issued, now)).toBe(0);
  });

  it('counts exactly 24h as 1 day', () => {
    const issued = new Date('2026-09-01T12:00:00Z');
    const now = new Date('2026-09-02T12:00:00Z');
    expect(daysSince(issued, now)).toBe(1);
  });

  it('counts multiple days', () => {
    const issued = new Date('2026-09-01T00:00:00Z');
    const now = new Date('2026-09-08T00:00:01Z');
    expect(daysSince(issued, now)).toBe(7);
  });

  it('floors 6.9 days to 6', () => {
    const issued = new Date('2026-09-01T00:00:00Z');
    const now = new Date('2026-09-07T21:36:00Z'); // 6.9 days later
    expect(daysSince(issued, now)).toBe(6);
  });

  it('clamps a future issue date to 0', () => {
    const issued = new Date('2026-09-10T00:00:00Z');
    const now = new Date('2026-09-01T00:00:00Z');
    expect(daysSince(issued, now)).toBe(0);
  });
});

describe('dripActionFor', () => {
  const issuedAt = '2026-09-01T00:00:00Z';

  it('accepts ISO strings', () => {
    expect(dripActionFor(issuedAt, new Date('2026-09-03T00:00:00Z'))).toBe('none');
    expect(dripActionFor(issuedAt, new Date('2026-09-05T00:00:00Z'))).toBe('reminder');
    expect(dripActionFor(issuedAt, new Date('2026-09-07T00:00:00Z'))).toBe('final_notice');
    expect(dripActionFor(issuedAt, new Date('2026-09-08T00:00:00Z'))).toBe('penalty_ineligible');
  });

  it('accepts Date objects', () => {
    const issued = new Date(issuedAt);
    expect(dripActionFor(issued, new Date('2026-09-04T00:00:00Z'))).toBe('none');
    expect(dripActionFor(issued, new Date('2026-09-05T12:00:00Z'))).toBe('reminder');
  });

  it('boundary: exactly at day 4 -> reminder', () => {
    expect(
      dripActionFor(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-05T00:00:00Z')),
    ).toBe('reminder');
  });

  it('just before day 4 -> none (floored)', () => {
    expect(
      dripActionFor(
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-04T23:59:59Z'),
      ),
    ).toBe('none');
  });

  it('defaults `now` to the current time', () => {
    const justIssued = new Date();
    expect(dripActionFor(justIssued)).toBe('none');
  });
});
