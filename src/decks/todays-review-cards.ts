import type { SupabaseClient } from '@supabase/supabase-js';
import { DECK_CARD_COLUMNS, toDeckCards, type DeckCard } from './deck-card.js';
import { fetchUserTimezone, findStartOfTomorrow } from './user-day.js';

/**
 * Cards already in review that one session takes, most overdue first.
 * Mirrors SESSION_DUE_CARDS_LIMIT in the app (src/constants/deck.ts).
 */
export const SESSION_DUE_CARDS_LIMIT = 10;

/**
 * Never-reviewed cards that one session takes.
 * Mirrors SESSION_NEW_CARDS_LIMIT in the app (src/constants/deck.ts).
 */
export const SESSION_NEW_CARDS_LIMIT = 5;

/** The user's cards, narrowed to one deck when they named one. */
const _selectDeckCards = (supabase: SupabaseClient, deckId: string | undefined) => {
  const query = supabase.from('user_cards').select(DECK_CARD_COLUMNS);
  return deckId === undefined ? query : query.eq('deck_id', deckId);
};

/** Today's review session, and how many cards are due today in all. */
export interface TodaysReviewSession {
  /** Cards due by the end of the user's day, most overdue first. */
  dueCards: DeckCard[];
  /** Never-reviewed cards the session adds after the due ones. */
  newCards: DeckCard[];
  /** Every card due by the end of the day, including those past the session's limit. */
  dueTodayCount: number;
}

/**
 * The review session the app would put in front of the user right now: cards
 * due by the end of their day, most overdue first, then a few they have never
 * reviewed.
 *
 * Reason: "due today" rather than "due right now". FSRS schedules to the
 * minute, so a strict `now` filter trickles cards in through the day instead
 * of handing over the day's reviews at once, and it would never offer a new
 * card at all. The limits are the app's, so a session in an AI client and one
 * in the app are the same size. The full due count comes along so the learner
 * hears that a session of ten is not the whole day when more are waiting.
 *
 * @param supabase - Client acting as the signed-in user
 * @param deckId - One deck to review, or undefined for all of them
 * @returns The session's due and new cards, and the day's due total
 * @throws {Error} When a read fails
 */
export const fetchTodaysReviewSession = async (
  supabase: SupabaseClient,
  deckId: string | undefined,
): Promise<TodaysReviewSession> => {
  const timezone = await fetchUserTimezone(supabase);
  const startOfTomorrow = findStartOfTomorrow(timezone, new Date()).toISOString();

  const [dueResponse, newResponse, dueCountResponse] = await Promise.all([
    _selectDeckCards(supabase, deckId)
      .lt('next_review', startOfTomorrow)
      .order('next_review', { ascending: true })
      .limit(SESSION_DUE_CARDS_LIMIT),
    _selectDeckCards(supabase, deckId)
      .is('next_review', null)
      .order('created_at', { ascending: true })
      .limit(SESSION_NEW_CARDS_LIMIT),
    _countDeckCards(supabase, deckId).lt('next_review', startOfTomorrow),
  ]);

  const error = dueResponse.error ?? newResponse.error ?? dueCountResponse.error;
  if (error) {
    throw new Error(`Could not read the user's deck: ${error.message}`);
  }

  return {
    dueCards: toDeckCards(dueResponse.data),
    newCards: toDeckCards(newResponse.data),
    dueTodayCount: dueCountResponse.count ?? 0,
  };
};

/** Counts the user's cards without reading them, narrowed to one deck when named. */
const _countDeckCards = (supabase: SupabaseClient, deckId: string | undefined) => {
  const query = supabase.from('user_cards').select('id', { count: 'exact', head: true });
  return deckId === undefined ? query : query.eq('deck_id', deckId);
};
