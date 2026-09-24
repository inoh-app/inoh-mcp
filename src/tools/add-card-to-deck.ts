import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as z from 'zod/v4';
import { getAuthenticatedUser, getUserAccessToken } from '../auth/index.js';
import { MAX_WORD_LENGTH } from '../constants.js';
import {
  describeMissingDeck,
  fetchDecks,
  findDeckByName,
  findDefaultDeck,
} from '../decks/index.js';
import { findCardById, findCardsByWord, type DictionaryCard } from '../dictionary/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { buildWordPageUrl } from '../web-app-urls.js';
import { buildCardChoiceQuestion, requireOneCardSelector } from './card-selection.js';
import { buildToolError } from './tool-result.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Prefix the enforce_card_limit trigger puts on its rejections. */
const CARD_LIMIT_ERROR_PREFIX = 'CARD_LIMIT:';

/**
 * The deck this card already sits in, if any.
 *
 * Reason: user_cards is unique on (user_id, dictionary_id), so a card is in at
 * most one deck. Checking first turns a raw constraint violation into an answer
 * that names the deck.
 */
const _findDeckHoldingCard = async (
  supabase: SupabaseClient,
  dictionaryId: string,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('user_cards')
    .select('deck_id')
    .eq('dictionary_id', dictionaryId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check the user's deck: ${error.message}`);
  }

  return (data as { deck_id: string } | null)?.deck_id ?? null;
};

const TOOL_TITLE = 'Add a card to a deck';

/**
 * Registers an `add_card_to_deck` tool that puts an existing dictionary card
 * into one of the signed-in user's decks.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerAddCardToDeckTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'add_card_to_deck',
    {
      title: TOOL_TITLE,
      annotations: {
        title: TOOL_TITLE,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "Adds a card that already exists to one of the signed-in user's decks, so it comes " +
        'up in their reviews. Identify it by `cardId` from search_dictionary, or by `word`. ' +
        'Use this for words already in the public Inoh dictionary; use create_private_card only ' +
        'when the dictionary does not have the word, since a public dictionary card is better ' +
        "than a generated duplicate. It also re-adds a card from the user's own private " +
        'dictionary that they had taken out of their deck. Adding costs nothing against the monthly private card allowance, though ' +
        "each plan caps how many cards a deck can hold in total. A card's review progress " +
        'starts fresh.',
      inputSchema: {
        word: z
          .string()
          .trim()
          .min(1)
          .max(MAX_WORD_LENGTH)
          .optional()
          .describe('The word to add, e.g. "serendipity". Use this or cardId.'),
        cardId: z
          .string()
          .uuid()
          .optional()
          .describe('The card id from search_dictionary. Use this or word.'),
        deckName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Name of an existing deck. Defaults to the user's default deck."),
      },
    },
    async ({ word, cardId, deckName }, extra) => {
      const selectorProblem = requireOneCardSelector(word, cardId);
      if (selectorProblem !== null) {
        return buildToolError(selectorProblem);
      }

      const user = getAuthenticatedUser(extra.authInfo);
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      let card: DictionaryCard | null = null;
      if (cardId !== undefined) {
        card = await findCardById(supabase, cardId);
        if (card === null) {
          return buildToolError(
            `No card found with id ${cardId}. Search the dictionary again to get a current id.`,
          );
        }
      } else if (word !== undefined) {
        const matches = await findCardsByWord(supabase, word);

        if (matches.length === 0) {
          return buildToolError(
            `"${word}" is not in the Inoh dictionary and the user has no card for it. ` +
              'Use create_private_card to have one made.',
          );
        }

        if (matches.length > 1) {
          return buildToolError(
            `There are ${matches.length} cards for "${word}". ` + buildCardChoiceQuestion(matches),
          );
        }

        card = matches[0] ?? null;
      }

      if (card === null) {
        return buildToolError('Could not work out which card to add.');
      }

      const decks = await fetchDecks(supabase);
      const targetDeck =
        deckName === undefined ? findDefaultDeck(decks) : findDeckByName(decks, deckName);

      if (targetDeck === undefined) {
        return buildToolError(
          deckName === undefined
            ? 'This account has no decks yet. Create one in the Inoh app first.'
            : describeMissingDeck(deckName, decks),
        );
      }

      const holdingDeckId = await _findDeckHoldingCard(supabase, card.id);
      if (holdingDeckId !== null) {
        const holdingDeck = decks.find((deck) => deck.id === holdingDeckId);
        return buildToolError(
          `"${card.word}" is already in ${
            holdingDeck === undefined ? 'one of their decks' : `their "${holdingDeck.name}" deck`
          }. A card can only be in one deck at a time; moving it between decks is done in the ` +
            'Inoh app.',
        );
      }

      // Reason: the FSRS columns are left to their database defaults, which are
      // exactly what the app's createEmptyCard() produces and what
      // approve_card_request has always relied on for generated cards.
      const { error } = await supabase.from('user_cards').insert({
        user_id: user.id,
        dictionary_id: card.id,
        deck_id: targetDeck.id,
      });

      if (error) {
        // Reason: the trigger's message is written for the user and carries the
        // plan's real numbers, so pass it through rather than restating it.
        if (error.message.includes(CARD_LIMIT_ERROR_PREFIX)) {
          const [, limitExplanation] = error.message.split(CARD_LIMIT_ERROR_PREFIX);
          return buildToolError(limitExplanation?.trim() ?? error.message);
        }
        if (error.code === POSTGRES_UNIQUE_VIOLATION) {
          return buildToolError(`"${card.word}" is already in the user's deck.`);
        }
        throw new Error(`Could not add the card: ${error.message}`);
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Added "${card.word}" to the "${targetDeck.name}" deck.\n` +
              buildWordPageUrl(card.id),
          },
        ],
      };
    },
  );
};
