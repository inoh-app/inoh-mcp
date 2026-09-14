import type { SupabaseClient } from '@supabase/supabase-js';

/** A deck as it comes back from the table. */
export interface DeckRow {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * Every deck belonging to the signed-in user.
 *
 * Callers fetch once and reuse the list, since naming the deck a card already
 * sits in needs the same rows as picking the deck to put it in.
 *
 * @param supabase - Client acting as the signed-in user
 * @returns Their decks, in no particular order
 * @throws {Error} When the lookup fails
 */
export const fetchDecks = async (supabase: SupabaseClient): Promise<DeckRow[]> => {
  // RLS scopes decks to the caller, so this can only ever return their own.
  const { data, error } = await supabase.from('decks').select('id, name, is_default');

  if (error) {
    throw new Error(`Could not look up your decks: ${error.message}`);
  }

  return (data ?? []) as DeckRow[];
};

/**
 * Find a deck by name, ignoring case.
 *
 * @param decks - The user's decks, from {@link fetchDecks}
 * @param deckName - Name the caller asked for
 * @returns The matching deck, or undefined when they have no deck by that name
 */
export const findDeckByName = (decks: DeckRow[], deckName: string): DeckRow | undefined =>
  decks.find((deck) => deck.name.toLowerCase() === deckName.toLowerCase());

/**
 * The deck a card goes in when the caller does not name one.
 *
 * Reason: `decks_one_default_per_user` guarantees at most one flagged deck, and
 * every account gets one at signup. The fallback covers an account whose flag
 * was somehow lost, so a missing flag costs the user nothing.
 *
 * @param decks - The user's decks, from {@link fetchDecks}
 * @returns Their default deck, or undefined when they have no decks at all
 */
export const findDefaultDeck = (decks: DeckRow[]): DeckRow | undefined =>
  decks.find((deck) => deck.is_default) ?? decks[0];

/**
 * Name the decks the user has, for a message that has to say what does exist.
 *
 * @param decks - The user's decks, from {@link fetchDecks}
 * @returns The names in quotes, or "none yet" for an account with no decks
 */
export const listDeckNames = (decks: DeckRow[]): string =>
  decks.map((deck) => `"${deck.name}"`).join(', ') || 'none yet';

/**
 * Explain that a named deck does not exist, and list what does.
 *
 * Reason: the advice at the end is specific to acting on one deck, where
 * omitting the name falls back to the default. A tool that reads across every
 * deck writes its own ending.
 *
 * @param deckName - Name the caller asked for
 * @param decks - The user's decks, from {@link fetchDecks}
 * @returns A message written for the person on the other end
 */
export const describeMissingDeck = (deckName: string, decks: DeckRow[]): string =>
  `No deck named "${deckName}". Your decks: ${listDeckNames(decks)}. ` +
  'Omit deckName to use the default deck.';
