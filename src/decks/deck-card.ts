import type { DictionaryCard } from '../dictionary/index.js';

/** A card the user holds, and the deck it sits in. */
export interface DeckCard extends DictionaryCard {
  deckId: string;
}

/**
 * The deck row with its dictionary entry attached.
 *
 * `!inner` is what makes a filter on the entry narrow the deck rows
 * themselves; a plain embed would return every card in the deck with the entry
 * blanked out on the ones that do not match.
 */
export const DECK_CARD_COLUMNS = 'deck_id, dictionary!inner(id, word, definition, owner_user_id)';

interface DeckCardRow {
  deck_id: string;
  dictionary: {
    id: string;
    word: string;
    definition: string;
    owner_user_id: string | null;
  };
}

/**
 * Turn the rows a {@link DECK_CARD_COLUMNS} select returned into deck cards.
 *
 * @param rows - Whatever came back in the response's `data`
 * @returns One card per row, the dictionary entry flattened into it
 */
export const toDeckCards = (rows: unknown): DeckCard[] =>
  ((rows ?? []) as DeckCardRow[]).map((row) => ({ ...row.dictionary, deckId: row.deck_id }));
