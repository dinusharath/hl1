/**
 * Parse a date-of-birth string into a date-only `Date`.
 *
 * DOB is a calendar date, not a moment in time. `new Date("1990-01-01")` parses as
 * UTC-midnight and can display as the previous day in a negative-offset timezone — so we
 * build the Date explicitly from UTC parts, sidestepping the shift entirely.
 *
 * Returns `null` for anything we can't trust (bad format, impossible date, future, absurd
 * age); the caller turns that into a NEEDS_REVIEW verdict. Non-ISO formats (e.g. DD/MM/YYYY)
 * are intentionally *not* guessed here — a `format` field-mapping normalises them first.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_AGE_YEARS = 120;

export function parseDateOfBirth(value: string, now: Date = new Date()): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  const date = new Date(Date.UTC(year, month - 1, day));

  // Reject rollovers like 2021-02-30 (JS would silently roll into March).
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!roundTrips) return null;

  if (date.getTime() > now.getTime()) return null; // not born in the future

  // Reject absurd ages — a DOB older than MAX_AGE_YEARS is almost certainly bad data.
  const oldestAllowed = new Date(Date.UTC(now.getUTCFullYear() - MAX_AGE_YEARS, now.getUTCMonth(), now.getUTCDate()));
  if (date.getTime() < oldestAllowed.getTime()) return null;

  return date;
}
