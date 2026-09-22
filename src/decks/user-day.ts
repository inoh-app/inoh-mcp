import type { SupabaseClient } from '@supabase/supabase-js';

/** Used when the user has no stored timezone, as the app and the backend do. */
const DEFAULT_TIMEZONE = 'UTC';

/**
 * The user's timezone, as the app last reported it.
 *
 * Reason: an AI client cannot tell us where the user is, and "due today" has
 * to mean their today, not the server's. The app keeps its device timezone on
 * the streak row, and record-review falls back to the same row, so both sides
 * agree on where a day ends.
 *
 * @param supabase - Client acting as the signed-in user
 * @returns An IANA timezone name
 */
export const fetchUserTimezone = async (supabase: SupabaseClient): Promise<string> => {
  const { data, error } = await supabase
    .from('user_session_streaks')
    .select('timezone')
    .maybeSingle<{ timezone: string | null }>();

  if (error) {
    throw new Error(`Could not read the user's timezone: ${error.message}`);
  }

  const timezone = data?.timezone;
  return timezone && _isKnownTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
};

/** Whether Intl can work with this timezone name. */
const _isKnownTimezone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
const _offsetFromUtc = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const partValue = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  const wallClockAsUtc = Date.UTC(
    partValue('year'),
    partValue('month') - 1,
    partValue('day'),
    partValue('hour'),
    partValue('minute'),
    partValue('second'),
  );

  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/**
 * The instant the user's next day begins: midnight tonight where they are.
 *
 * Reason: a card counts as due today when it falls before this, which is the
 * app's "due by end of today" in the form a `<` filter needs.
 *
 * @param timeZone - The user's IANA timezone
 * @param now - The moment to measure from
 * @returns Midnight at the start of tomorrow in that timezone
 * @throws {RangeError} When the timezone name is not one Intl knows
 */
export const findStartOfTomorrow = (timeZone: string, now: Date): Date => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const tomorrowMidnightAsUtc = Date.UTC(year, month - 1, day + 1);

  // Reason: the offset at midnight can differ from the offset now across a
  // daylight-saving change, so it is read at the guess and then re-read once
  // at the corrected instant.
  const firstGuess =
    tomorrowMidnightAsUtc - _offsetFromUtc(new Date(tomorrowMidnightAsUtc), timeZone);
  return new Date(tomorrowMidnightAsUtc - _offsetFromUtc(new Date(firstGuess), timeZone));
};
