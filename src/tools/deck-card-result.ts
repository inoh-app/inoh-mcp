import type { DeckCard, DeckRow } from '../decks/index.js';
import { buildWordPageUrl } from '../web-app-urls.js';

/** One of the user's cards, as the deck tools hand it to an AI client. */
export interface DeckCardResult {
  /** The card's dictionary id, which every other card tool takes. */
  cardId: string;
  word: string;
  definition: string;
  /** Which of the user's decks holds it. */
  deckName: string;
  /** True when this is a card the user made rather than a public dictionary entry. */
  isPrivate: boolean;
  /** Word page in the Inoh web app, so clients can link to the full card. */
  url: string;
}

/**
 * Name the deck a card sits in.
 *
 * The fallback cannot normally happen: both the decks and the cards come from
 * the same account under RLS. It costs the user nothing if it ever does.
 */
const _nameDeck = (decks: DeckRow[], deckId: string): string =>
  decks.find((deck) => deck.id === deckId)?.name ?? 'their deck';

/**
 * Describe one of the user's cards for an AI client.
 *
 * @param card - The card, with the deck it sits in
 * @param decks - The user's decks, from `fetchDecks`
 * @returns The card as the deck tools report it
 */
export const toDeckCardResult = (card: DeckCard, decks: DeckRow[]): DeckCardResult => ({
  cardId: card.id,
  word: card.word,
  definition: card.definition,
  deckName: _nameDeck(decks, card.deckId),
  isPrivate: card.owner_user_id !== null,
  url: buildWordPageUrl(card.id),
});
