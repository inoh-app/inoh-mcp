import { buildWordPageUrl } from '../web-app-urls.js';

/** Which dictionary a request is headed for; mirrors `card_requests.destination`. */
export type CardRequestDestination = 'private' | 'public';

/**
 * The database statuses collapsed into what a caller actually needs, across
 * both dictionaries.
 *
 * - `generating`: Inoh is building the card.
 * - `with_a_reviewer`: built, and waiting for a person at Inoh to decide.
 *   Public only — a private card is published straight to its owner.
 * - `ready`: a private card, in the user's deck.
 * - `published`: a public entry, in the dictionary for everyone.
 * - `declined`: a reviewer decided against it. Public only.
 * - `failed`: Inoh could not make it.
 * - `deleted`: it was made, and the card no longer exists.
 */
export type CardRequestProgress =
  'generating' | 'with_a_reviewer' | 'ready' | 'published' | 'declined' | 'failed' | 'deleted';

/** Columns every card-request tool reads back from `card_requests`. */
export const CARD_REQUEST_COLUMNS =
  'id, word, context, status, destination, error_reason, error_detail, dictionary_id, target_dictionary_id, created_at';

export interface CardRequestRow {
  id: string;
  word: string;
  context: string;
  status: string;
  destination: string;
  error_reason: string | null;
  error_detail: string | null;
  dictionary_id: string | null;
  target_dictionary_id: string | null;
  created_at: string;
}

export interface CardRequestStatus {
  requestId: string;
  word: string;
  context: string;
  /** Which dictionary it is headed for: the user's own, or everyone's. */
  destination: CardRequestDestination;
  progress: CardRequestProgress;
  requestedAt: string;
  /** Set once the card exists. This is what delete_private_card takes. */
  cardId?: string;
  /** Set once the card exists, so the client can link straight to it. */
  cardUrl?: string;
  /**
   * Set when this request rewrites a card that already existed rather than
   * making a new one, so a caller does not report a redo as a new card.
   */
  redoOfCardId?: string;
  /** Why it could not be made, when it could not be made. */
  error?: string;
  /** What the progress alone does not say, when there is more to it. */
  note?: string;
}

/** What each ending needs said beyond its name. */
const DELETED_NOTES: Record<CardRequestDestination, string> = {
  private: 'The user deleted this card.',
  public: 'This entry has since been removed from the public dictionary.',
};

const DECLINED_NOTE =
  'A reviewer decided this one does not belong in the public dictionary. The user can still ' +
  'have the word as a private card of their own.';

/**
 * Which dictionary this row is headed for.
 *
 * Reason: a check constraint limits the column to the two values, so the
 * fallback is unreachable today. It reads as `public` rather than throwing
 * because that is the column's own default — the value a client that inserts
 * without naming a destination gets.
 */
const _readDestination = (row: CardRequestRow): CardRequestDestination =>
  row.destination === 'private' ? 'private' : 'public';

/**
 * Collapse a request's status the way the app's My Requests screen does.
 *
 * Reason: `failed` with no error_reason means the pipeline will pick the row up
 * again, so it is still in progress as far as the user is concerned. Only a
 * classified failure is worth reporting as one.
 *
 * `rejected` is a person's decision rather than a breakdown, which is why it
 * reads as declined and not as failed. It can only arise on a public request:
 * a private one never enters review, because publish_private_card takes it
 * from generating straight to approved.
 *
 * An approved request whose `dictionary_id` is null is a card that no longer
 * exists — the FK is ON DELETE SET NULL, and the request row itself is kept
 * because it is what the monthly quota counts. Reporting that as ready would
 * have a caller hand out a link to a card that has gone.
 */
const _readProgress = (
  row: CardRequestRow,
  destination: CardRequestDestination,
): CardRequestProgress => {
  if (row.status === 'approved') {
    if (row.dictionary_id === null) return 'deleted';
    return destination === 'public' ? 'published' : 'ready';
  }
  if (row.status === 'rejected') return 'declined';
  if (row.status === 'review') return 'with_a_reviewer';
  if (row.status === 'failed' && row.error_reason !== null) return 'failed';
  return 'generating';
};

/**
 * Each state as it reads in a sentence about one word.
 *
 * Reason: the verb belongs to the state rather than to the sentence — a
 * decision a reviewer already made reads as "was declined", where work still
 * under way reads as "is".
 */
const PROGRESS_PHRASES: Record<CardRequestProgress, string> = {
  generating: 'is still being made',
  with_a_reviewer: 'is waiting on an Inoh reviewer',
  ready: 'is ready',
  published: 'is in the public dictionary now',
  declined: 'was declined by a reviewer',
  failed: 'could not be made',
  deleted: 'is gone: the card it made no longer exists',
};

/**
 * What this request is, in the words that tell it from the other two kinds: a
 * card of the user's own, a redo of one, or a word offered to everyone.
 */
const _describeSubject = (status: CardRequestStatus): string => {
  if (status.redoOfCardId !== undefined) return `The redo of "${status.word}"`;

  return status.destination === 'public'
    ? `The suggestion of "${status.word}"`
    : `Card "${status.word}"`;
};

/**
 * How to describe one request in a sentence.
 *
 * @param status - A shaped status
 * @returns A phrase naming the word and what is happening to it
 */
export const describeCardRequestStatus = (status: CardRequestStatus): string =>
  `${_describeSubject(status)} ${PROGRESS_PHRASES[status.progress]}.`;

/**
 * Shape one `card_requests` row into the status a tool reports.
 *
 * @param row - A row belonging to the signed-in user
 * @returns Progress plus the card link, failure reason or note, when there is one
 */
export const toCardRequestStatus = (row: CardRequestRow): CardRequestStatus => {
  const destination = _readDestination(row);
  const progress = _readProgress(row, destination);
  const hasCard = progress === 'ready' || progress === 'published';

  return {
    requestId: row.id,
    word: row.word,
    context: row.context,
    destination,
    progress,
    requestedAt: row.created_at,
    ...(row.target_dictionary_id === null ? {} : { redoOfCardId: row.target_dictionary_id }),
    ...(hasCard && row.dictionary_id !== null
      ? { cardId: row.dictionary_id, cardUrl: buildWordPageUrl(row.dictionary_id) }
      : {}),
    ...(progress === 'deleted' ? { note: DELETED_NOTES[destination] } : {}),
    ...(progress === 'declined' ? { note: DECLINED_NOTE } : {}),
    ...(progress === 'failed'
      ? { error: row.error_detail ?? row.error_reason ?? 'Generation failed.' }
      : {}),
  };
};
