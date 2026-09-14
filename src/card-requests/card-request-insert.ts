import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Sense hint stored when the caller does not give one.
 *
 * Reason: card_requests.context is NOT NULL and is fed to the generator as the
 * sense to teach, so it cannot simply be blank. Naming the common meaning is
 * both true to what the user asked for and a usable hint.
 *
 * @param word - The word the card teaches
 * @returns A context the generator can work from
 */
export const buildDefaultContext = (word: string): string => `the most common meaning of "${word}"`;

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Prefixes the database uses for limits and refusals, so each gets its own explanation. */
const QUOTA_ERROR_PREFIX = 'PRIVATE_CARD_LIMIT:';
const DAILY_CEILING_ERROR_PREFIX = 'DAILY_CARD_REQUEST_LIMIT:';
const CLIENT_WRITE_ERROR_PREFIX = 'CARD_REQUEST_CLIENT_WRITE:';

/** Take the human half of a prefixed database message. */
const _readMessageAfterPrefix = (message: string, prefix: string): string =>
  message.split(prefix)[1]?.trim() ?? message;

/**
 * Turn a failed `card_requests` insert into something worth saying.
 *
 * Shared by create_private_card and update_private_card: both insert the same
 * row, so both meet the same triggers — the monthly quota, the daily ceiling,
 * the client-write lockdown, and two unique indexes covering work already in
 * flight.
 *
 * @param error - The error PostgREST returned
 * @param alreadyInFlightMessage - What to say when a matching request is
 *   already queued, which differs between making a card and redoing one
 * @returns A message for the caller, or null when this is not a failure we can
 *   explain and the caller should throw
 */
export const describeCardRequestInsertError = (
  error: PostgrestError,
  alreadyInFlightMessage: string,
): string | null => {
  if (error.code === POSTGRES_UNIQUE_VIOLATION) {
    return alreadyInFlightMessage;
  }

  // Reason: both limit triggers raise messages written for the user, so pass
  // them through rather than restating them worse.
  if (error.message.includes(QUOTA_ERROR_PREFIX)) {
    return _readMessageAfterPrefix(error.message, QUOTA_ERROR_PREFIX);
  }

  if (error.message.includes(DAILY_CEILING_ERROR_PREFIX)) {
    return (
      'That is a lot of cards in one day. Inoh has stopped accepting new ones until ' +
      'tomorrow as a safety measure.'
    );
  }

  if (error.message.includes(CLIENT_WRITE_ERROR_PREFIX)) {
    return _readMessageAfterPrefix(error.message, CLIENT_WRITE_ERROR_PREFIX);
  }

  return null;
};
