import type { SupabaseClient } from '@supabase/supabase-js';
import {
  allowedEditDistance,
  measureEditDistance,
  type DictionaryCard,
} from '../dictionary/index.js';

/** A card the user holds, and the deck it sits in. */
export interface DeckCard extends DictionaryCard {
  deckId: string;
}

/**
 * The deck row with its dictionary entry attached.
 *
 * `!inner` is what makes the word filter narrow the deck rows themselves; a
 * plain embed would return every card in the deck with the entry blanked out
 * on the ones that do not match.
 */
const DECK_CARD_COLUMNS = 'deck_id, dictionary!inner(id, word, definition, owner_user_id)';

/**
 * How many matches come back, mirroring `search_dictionary_words` so a search
 * of the deck behaves like a search anywhere else in Inoh.
 */
export const DECK_SEARCH_RESULT_LIMIT = 20;

/** How many near misses are considered before the closest ones are picked. */
const TYPO_CANDIDATE_LIMIT = 50;

/** How much of the query a candidate has to start with to be considered a typo of it. */
const TYPO_PREFIX_LENGTH = 4;

interface DeckCardRow {
  deck_id: string;
  dictionary: {
    id: string;
    word: string;
    definition: string;
    owner_user_id: string | null;
  };
}

const _toDeckCard = (row: DeckCardRow): DeckCard => ({
  ...row.dictionary,
  deckId: row.deck_id,
});

/** Escapes the characters LIKE reads as wildcards, so a query matches itself. */
const _escapeLikeWildcards = (text: string): string =>
  text.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);

/**
 * The pattern `search_dictionary_words` builds: every token in order, with
 * anything allowed before, between and after them, so "get by" finds "get
 * away by".
 */
const _buildContainsPattern = (normalizedQuery: string): string =>
  `%${_escapeLikeWildcards(normalizedQuery).split(/\s+/).join('%')}%`;

/**
 * The user's cards whose word matches a LIKE pattern, alphabetically.
 *
 * @param supabase - Client acting as the signed-in user
 * @param pattern - A LIKE pattern, wildcards already escaped
 * @param deckId - One deck to look in, or undefined for all of them
 * @param limit - How many rows to take
 * @throws {Error} When the search fails
 */
const _fetchDeckCardsMatching = async (
  supabase: SupabaseClient,
  pattern: string,
  deckId: string | undefined,
  limit: number,
): Promise<DeckCard[]> => {
  // RLS scopes user_cards to the caller, so this can only ever read their own
  // decks, and the dictionary policy only lets it join public entries and
  // their own cards.
  let query = supabase
    .from('user_cards')
    .select(DECK_CARD_COLUMNS)
    .ilike('dictionary.word', pattern)
    .order('dictionary(word)')
    .limit(limit);

  if (deckId !== undefined) {
    query = query.eq('deck_id', deckId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not search the user's deck: ${error.message}`);
  }

  return ((data ?? []) as unknown as DeckCardRow[]).map(_toDeckCard);
};

/** Puts an exact match first, leaving the alphabetical order otherwise intact. */
const _sortExactMatchFirst = (cards: DeckCard[], normalizedQuery: string): DeckCard[] => {
  const isExactMatch = (card: DeckCard) => card.word.toLowerCase() === normalizedQuery;

  // Reason: sort is stable, so the alphabetical order the query returned survives.
  return [...cards].sort(
    (firstCard, secondCard) => Number(isExactMatch(secondCard)) - Number(isExactMatch(firstCard)),
  );
};

/**
 * The user's cards whose word is a near miss for the query, closest first.
 *
 * @param supabase - Client acting as the signed-in user
 * @param normalizedQuery - The query, trimmed and lowercased
 * @param deckId - One deck to look in, or undefined for all of them
 * @returns Cards within a typo's distance of the query
 * @throws {Error} When the search fails
 */
const _findTypoMatches = async (
  supabase: SupabaseClient,
  normalizedQuery: string,
  deckId: string | undefined,
): Promise<DeckCard[]> => {
  const prefix = _escapeLikeWildcards(normalizedQuery.slice(0, TYPO_PREFIX_LENGTH));
  const candidates = await _fetchDeckCardsMatching(
    supabase,
    `${prefix}%`,
    deckId,
    TYPO_CANDIDATE_LIMIT,
  );
  const maxDistance = allowedEditDistance(normalizedQuery.length);

  return candidates
    .map((card) => ({
      card,
      distance: measureEditDistance(normalizedQuery, card.word.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((firstMatch, secondMatch) => firstMatch.distance - secondMatch.distance)
    .slice(0, DECK_SEARCH_RESULT_LIMIT)
    .map(({ card }) => card);
};

/**
 * Search the cards the signed-in user holds, the same two ways the app's deck
 * search does:
 *
 * 1. Contains match — "tang" finds "tangent", exact matches first
 * 2. Typo-tolerant fallback when nothing contains the query — "platiudinous"
 *    finds "platitudinous"
 *
 * Reason: it searches from the deck rather than filtering a dictionary search,
 * so a card the user holds cannot be crowded out by the 45,000 public entries
 * that happen to match the same fragment.
 *
 * @param supabase - Client acting as the signed-in user
 * @param query - Word or fragment to look for
 * @param deckId - One deck to look in, or undefined for all of them
 * @returns Matching cards, at most {@link DECK_SEARCH_RESULT_LIMIT} of them
 * @throws {Error} When the search fails
 */
export const searchDeckCards = async (
  supabase: SupabaseClient,
  query: string,
  deckId: string | undefined,
): Promise<DeckCard[]> => {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery === '') {
    return [];
  }

  const containsMatches = await _fetchDeckCardsMatching(
    supabase,
    _buildContainsPattern(normalizedQuery),
    deckId,
    DECK_SEARCH_RESULT_LIMIT,
  );

  return containsMatches.length > 0
    ? _sortExactMatchFirst(containsMatches, normalizedQuery)
    : _findTypoMatches(supabase, normalizedQuery, deckId);
};
