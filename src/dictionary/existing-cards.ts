import type { SupabaseClient } from '@supabase/supabase-js';
import { findCardsByWord, type DictionaryCard } from './find-cards.js';

/**
 * Whether Inoh already has the card someone is about to ask for.
 *
 * The rule is the one the Inoh app and the Raycast extension follow, so all
 * four surfaces agree on what counts as a duplicate: the public dictionary is
 * matched on what a card teaches, the user's own cards on the word alone.
 */

/**
 * How close a suggested card has to be to one Inoh already holds before we
 * say so.
 *
 * Calibrated against the real dictionary rather than guessed, because two
 * senses of one word already score high: the word itself sits in both
 * embedded strings. `pnpm calibrate:sense-threshold` in inoh-backend measures
 * two distributions and prints the trade at every candidate. On 45,558 public
 * entries (420 known-different sense pairs, 356 known-same pairs), 0.81
 * interrupts 4.5% of genuine second senses and catches 77% of duplicates.
 *
 * Mirrors SAME_CARD_SIMILARITY_THRESHOLD in the app and the extension; move
 * them together or the surfaces start disagreeing about the same word.
 */
const SAME_CARD_SIMILARITY_THRESHOLD = 0.81;

type SenseMatch = { id: string; similarity: number };
type MatchSensesResponse = { matches?: Array<{ word: string; senses: SenseMatch[] }> };

/**
 * The public dictionary's closest sense to the meaning given, if it is close
 * enough to be the same card.
 *
 * Reason: matched on meaning rather than on spelling. A word the dictionary
 * carries in one sense is still missing every other sense of itself, and
 * refusing those was the crude behaviour this replaced.
 *
 * Never throws. A rate-limited or failing service answers "no match", which
 * costs the caller a warning rather than their card.
 *
 * @param supabase - Client acting as the signed-in user
 * @param word - The word being asked for
 * @param definition - The sense its card should teach
 * @returns The matching dictionary id, or null when nothing is close enough
 */
const _findMatchingPublicSenseId = async (
  supabase: SupabaseClient,
  word: string,
  definition: string,
): Promise<string | null> => {
  const { data, error } = await supabase.functions.invoke<MatchSensesResponse>(
    'match-anki-senses',
    { body: { items: [{ word, context: definition }] } },
  );
  if (error !== null) return null;

  const [bestSense] = data?.matches?.[0]?.senses ?? [];
  return bestSense !== undefined && bestSense.similarity >= SAME_CARD_SIMILARITY_THRESHOLD
    ? bestSense.id
    : null;
};

/** What Inoh already holds for a word, split by whose it is. */
export interface ExistingCards {
  /** Public entries that look to teach the same thing. */
  publicCards: DictionaryCard[];
  /** The caller's own cards for the word, whatever sense they teach. */
  ownCards: DictionaryCard[];
}

/**
 * Looks for the card someone is about to ask for, in both dictionaries.
 *
 * The two halves answer differently on purpose. A public entry is compared on
 * what it teaches, so a genuinely new sense of a word Inoh already carries
 * passes straight through. The caller's own cards are compared on the word
 * alone, because a private card is published without an embedding and so has
 * no vector to compare against.
 *
 * Without a definition there is nothing to compare, so the public side falls
 * back to matching the word. That is the older, blunter check, and it is
 * still better than no check at all.
 *
 * @param supabase - Client acting as the signed-in user
 * @param word - The word being asked for
 * @param definition - The sense its card should teach, when the caller said
 * @returns What Inoh already holds, public and own kept apart
 * @throws {Error} When the dictionary lookup fails
 */
export const findExistingCards = async (
  supabase: SupabaseClient,
  word: string,
  definition: string | undefined,
): Promise<ExistingCards> => {
  const cardsForWord = await findCardsByWord(supabase, word);
  const ownCards = cardsForWord.filter((card) => card.owner_user_id !== null);
  const publicCardsForWord = cardsForWord.filter((card) => card.owner_user_id === null);

  if (definition === undefined) {
    return { publicCards: publicCardsForWord, ownCards };
  }

  const matchingSenseId = await _findMatchingPublicSenseId(supabase, word, definition);
  return {
    publicCards: publicCardsForWord.filter((card) => card.id === matchingSenseId),
    ownCards,
  };
};
