import type { DictionaryCard } from '../dictionary/index.js';

/** A card the user holds, and the deck it sits in. */
export interface DeckCard extends DictionaryCard {
  deckId: string;
  /**
   * True when the card is beyond the user's plan limit: still theirs and
   * searchable, but left out of every review until they upgrade (PRI-21123).
   */
  isReviewPaused: boolean;
}

/**
 * The deck row with its dictionary entry attached.
 *
 * `!inner` is what makes a filter on the entry narrow the deck rows
 * themselves; a plain embed would return every card in the deck with the entry
 * blanked out on the ones that do not match.
 */
export const DECK_CARD_COLUMNS =
  'user_card_decks!inner(deck_id, is_review_paused), dictionary!inner(id, word, definition, owner_user_id)';

interface DeckCardRow {
  user_card_decks: { deck_id: string; is_review_paused: boolean }[];
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
  ((rows ?? []) as DeckCardRow[]).flatMap((row) => {
    const membership =
      row.user_card_decks.find((placement) => !placement.is_review_paused) ??
      row.user_card_decks[0];
    return membership
      ? [
          {
            ...row.dictionary,
            deckId: membership.deck_id,
            isReviewPaused: membership.is_review_paused,
          },
        ]
      : [];
  });
