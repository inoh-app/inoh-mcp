import type { SupabaseClient } from '@supabase/supabase-js';
import { DECK_CARD_COLUMNS, toDeckCards, type DeckCard } from './deck-card.js';
import { fetchTodaysReviewSession } from './todays-review-cards.js';

/**
 * The ways a caller can take cards out of a deck without naming a word.
 *
 * `due` is today's review session, as the app would deal it. `due` and
 * `struggling` read the review columns; neither writes anything back, so
 * browsing never disturbs a card's schedule. Only recording a review does.
 */
export type DeckSelection = 'random' | 'newest' | 'oldest' | 'due' | 'struggling';

/** How many cards come back when the caller does not say. */
export const DECK_BROWSE_DEFAULT_COUNT = 20;

/**
 * Most cards one browse returns.
 *
 * Reason: a chat client reads the whole result, so a bigger answer costs the
 * user context without telling them more. They can always ask again.
 */
export const DECK_BROWSE_MAX_COUNT = 50;

/**
 * How many cards a random draw chooses between.
 *
 * Reason: the sample is taken here rather than in Postgres, so the pool has to
 * be bounded. Only Pro decks can pass this, and a draw from their first few
 * thousand cards is still a fresh handful every time.
 */
const RANDOM_POOL_LIMIT = 5000;

/** What to take out of the deck, and how much of it. */
export interface DeckBrowseRequest {
  selection: DeckSelection;
  /** How many cards to take, at most {@link DECK_BROWSE_MAX_COUNT}. */
  count: number;
  /** One deck to read, or undefined for all of them. */
  deckId: string | undefined;
}

/** The cards a browse took, and for `due`, how many more wait today. */
export interface DeckBrowseResult {
  cards: DeckCard[];
  /**
   * Cards due today that this session left out. Set only for `due`, where a
   * session of ten is not the whole day when more are waiting.
   */
  moreDueTodayCount?: number;
}

/**
 * The user's cards, narrowed to one deck when they named one.
 *
 * RLS scopes user_cards to the caller, so this can only ever read their own
 * decks, and the dictionary policy only lets it join public entries and their
 * own cards.
 */
const _selectDeckCards = (
  supabase: SupabaseClient,
  deckId: string | undefined,
  columns: string,
) => {
  const query = supabase.from('user_cards').select(columns);

  return deckId === undefined ? query : query.eq('deck_id', deckId);
};

/**
 * Cards in the order the selection asks for.
 *
 * `struggling` asks for cards forgotten at least once, so a deck nobody has
 * got wrong comes back empty rather than arbitrary.
 *
 * @param supabase - Client acting as the signed-in user
 * @param selection - Which cards to take; random is drawn elsewhere
 * @param deckId - One deck to read, or undefined for all of them
 * @param count - How many cards to take
 * @returns The response, for the caller to check for an error
 */
const _fetchOrderedDeckCards = async (
  supabase: SupabaseClient,
  selection: Exclude<DeckSelection, 'random' | 'due'>,
  deckId: string | undefined,
  count: number,
) => {
  const cards = _selectDeckCards(supabase, deckId, DECK_CARD_COLUMNS);

  switch (selection) {
    case 'newest':
      return cards.order('created_at', { ascending: false }).limit(count);
    case 'oldest':
      return cards.order('created_at', { ascending: true }).limit(count);
    case 'struggling':
      return cards
        .gt('forget_count', 0)
        .order('forget_count', { ascending: false })
        .order('difficulty', { ascending: false })
        .limit(count);
  }
};

/** A copy of the values in a random order: give each one a random key, sort by it. */
const _shuffle = <Value>(values: Value[]): Value[] =>
  values
    .map((value) => ({ value, sortKey: Math.random() }))
    .sort((first, second) => first.sortKey - second.sortKey)
    .map(({ value }) => value);

/**
 * A random handful of the user's cards.
 *
 * Reason: PostgREST has no `order by random()`, so the draw happens here in
 * two steps. The first asks only for row ids — one uuid per card — and the
 * second joins the dictionary for the few that were drawn, so a full deck
 * never has to travel just to pick twenty words out of it.
 *
 * @param supabase - Client acting as the signed-in user
 * @param deckId - One deck to draw from, or undefined for all of them
 * @param count - How many cards to draw
 * @returns The drawn cards, themselves in a random order
 * @throws {Error} When either step fails
 */
const _drawRandomDeckCards = async (
  supabase: SupabaseClient,
  deckId: string | undefined,
  count: number,
): Promise<DeckCard[]> => {
  const { data: idRows, error: idError } = await _selectDeckCards(supabase, deckId, 'id').limit(
    RANDOM_POOL_LIMIT,
  );

  if (idError) {
    throw new Error(`Could not read the user's deck: ${idError.message}`);
  }

  const ids = ((idRows ?? []) as unknown as { id: string }[]).map((row) => row.id);
  const drawnIds = _shuffle(ids).slice(0, count);

  if (drawnIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_cards')
    .select(DECK_CARD_COLUMNS)
    .in('id', drawnIds);

  if (error) {
    throw new Error(`Could not read the user's deck: ${error.message}`);
  }

  // The ids were drawn at random but come back in the table's own order, so
  // the cards are shuffled again before anyone sees them.
  return _shuffle(toDeckCards(data));
};

/**
 * Take cards out of the user's decks without searching for a word: a random
 * handful, the ones added most or least recently, the ones due for review, or
 * the ones they forget most often.
 *
 * @param supabase - Client acting as the signed-in user
 * @param request - Which cards to take, how many, and from which deck
 * @returns The chosen cards, at most `request.count` of them
 * @throws {Error} When the read fails
 */
export const browseDeckCards = async (
  supabase: SupabaseClient,
  { selection, count, deckId }: DeckBrowseRequest,
): Promise<DeckBrowseResult> => {
  if (selection === 'random') {
    return { cards: await _drawRandomDeckCards(supabase, deckId, count) };
  }

  if (selection === 'due') {
    const { dueCards, newCards, dueTodayCount } = await fetchTodaysReviewSession(supabase, deckId);
    const shownDueCount = Math.min(dueCards.length, count);
    return {
      cards: [...dueCards, ...newCards].slice(0, count),
      moreDueTodayCount: dueTodayCount - shownDueCount,
    };
  }

  const { data, error } = await _fetchOrderedDeckCards(supabase, selection, deckId, count);

  if (error) {
    throw new Error(`Could not read the user's deck: ${error.message}`);
  }

  return { cards: toDeckCards(data) };
};
