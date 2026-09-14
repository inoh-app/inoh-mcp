import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getUserAccessToken } from '../auth/index.js';
import { MAX_WORD_LENGTH } from '../constants.js';
import {
  DECK_SEARCH_RESULT_LIMIT,
  fetchDecks,
  findDeckByName,
  listDeckNames,
  searchDeckCards,
  type DeckCard,
  type DeckRow,
} from '../decks/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { buildWordPageUrl } from '../web-app-urls.js';
import { buildToolError } from './tool-result.js';

interface DeckSearchResult {
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

const _toSearchResult = (card: DeckCard, decks: DeckRow[]): DeckSearchResult => ({
  cardId: card.id,
  word: card.word,
  definition: card.definition,
  deckName: _nameDeck(decks, card.deckId),
  isPrivate: card.owner_user_id !== null,
  url: buildWordPageUrl(card.id),
});

/**
 * Registers a `search_deck` tool that searches the cards the signed-in user
 * already holds, rather than the dictionary they could add from.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerSearchDeckTool = (server: McpServer, connection: SupabaseConnection): void => {
  server.registerTool(
    'search_deck',
    {
      title: 'Search the deck',
      description:
        'Searches the words the signed-in user already has in their decks. Use it to answer ' +
        '"do I have this word?", and to check before adding a word, since a card they already ' +
        'hold cannot be added again. Matches the word on the card, not its definition, so it ' +
        'finds "get by" from "get" but cannot find a card by its topic. Takes the cards ' +
        'containing the query (exact matches first) and falls back to typo-tolerant matching ' +
        `when nothing contains it. Returns up to ${DECK_SEARCH_RESULT_LIMIT} cards with ` +
        'cardId, word, definition, which deck holds it, a link to the word page on inoh.app, ' +
        'and `isPrivate` — true for a card the user made, so describe it as theirs rather than ' +
        'as an Inoh entry, and remember only those can be deleted or remade. Pass a cardId to ' +
        'remove_card_from_deck or update_private_card to act on one. This searches only what ' +
        'they hold: search_dictionary is what finds words they could add.',
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(MAX_WORD_LENGTH)
          .describe('Word or fragment to look for in their decks, e.g. "tangent" or "get by"'),
        deckName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Name of one deck to search. Omit to search every deck they have.'),
      },
    },
    async ({ query, deckName }, extra) => {
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));
      const decks = await fetchDecks(supabase);

      const chosenDeck = deckName === undefined ? undefined : findDeckByName(decks, deckName);
      if (deckName !== undefined && chosenDeck === undefined) {
        return buildToolError(
          `No deck named "${deckName}". Your decks: ${listDeckNames(decks)}. ` +
            'Omit deckName to search all of them.',
        );
      }

      const matches = await searchDeckCards(supabase, query, chosenDeck?.id);
      const results = matches.map((card) => _toSearchResult(card, decks));
      const searchedLabel =
        chosenDeck === undefined ? 'any of their decks' : `their "${chosenDeck.name}" deck`;

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Nothing in ${searchedLabel} matches "${query}", so they are not learning that ` +
                'word yet. search_dictionary finds it in the Inoh dictionary, and ' +
                'add_card_to_deck puts it in their deck.',
            },
          ],
        };
      }

      const capNote =
        results.length === DECK_SEARCH_RESULT_LIMIT
          ? ' That is as many as one search returns, so they may hold more.'
          : '';

      return {
        content: [
          {
            type: 'text',
            text:
              `${results.length} card(s) in ${searchedLabel} match "${query}".${capNote}\n` +
              JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );
};
