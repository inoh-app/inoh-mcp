import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getUserAccessToken } from '../auth/index.js';
import {
  browseDeckCards,
  DECK_BROWSE_DEFAULT_COUNT,
  DECK_BROWSE_MAX_COUNT,
  fetchDecks,
  findDeckByName,
  listDeckNames,
  type DeckSelection,
} from '../decks/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { toDeckCardResult } from './deck-card-result.js';
import { buildToolError } from './tool-result.js';

/** How each selection is described back to the client, after the count. */
const SELECTION_SUMMARIES: Record<DeckSelection, string> = {
  random: 'drawn at random',
  newest: 'the most recently added first',
  oldest: 'the longest-held first',
  due:
    "in today's review session: the ones due today, most overdue first, then a few they " +
    'have never reviewed. Quiz them one card at a time and record each answer with ' +
    'record_review as soon as they give it',
  struggling: 'the ones they forget most often first',
};

/** Said when the deck holds no cards at all, whichever way the caller asked. */
const _describeEmptyDeck = (scope: string): string =>
  `There are no cards in ${scope} yet. search_dictionary finds words to learn, and ` +
  'add_card_to_deck puts one in a deck.';

/**
 * Tells the client whether today's session is the whole day.
 *
 * Reason: a session stops at ten due cards, the app's size, so a learner with
 * forty due would otherwise finish it believing the day was done.
 *
 * @param moreDueTodayCount - Cards due today that the session left out
 * @returns A sentence to follow the session summary
 */
const _describeMoreDueToday = (moreDueTodayCount: number): string =>
  moreDueTodayCount === 0
    ? ' That is everything due today.'
    : ` ${moreDueTodayCount} more card${moreDueTodayCount === 1 ? ' is' : 's are'} due today ` +
      'after these. Tell them so when you start, and offer another session once this one is done.';

/**
 * What to say when a selection comes back with nothing, which for `due` and
 * `struggling` is good news about the deck rather than an empty one.
 */
const DESCRIBE_EMPTY_RESULT: Record<DeckSelection, (scope: string) => string> = {
  random: _describeEmptyDeck,
  newest: _describeEmptyDeck,
  oldest: _describeEmptyDeck,
  due: (scope) =>
    `Nothing in ${scope} is left to review today — no card is due and none is waiting for a ` +
    'first review. That is the day done.',
  struggling: (scope) =>
    `No card in ${scope} has been forgotten in a review yet, so there is nothing they are ` +
    'struggling with.',
};

const TOOL_TITLE = 'Browse the deck';

/**
 * Registers a `browse_deck` tool that hands back cards the user already holds
 * without being given a word to look for.
 *
 * Reason: `search_deck` answers "do I have this word?" and needs a query to do
 * it. Everything a learner asks about their deck as a whole — a random
 * handful, what they added lately, what is due, what they keep forgetting —
 * has no query to give, which is what this tool is for.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerBrowseDeckTool = (server: McpServer, connection: SupabaseConnection): void => {
  server.registerTool(
    'browse_deck',
    {
      title: TOOL_TITLE,
      annotations: { title: TOOL_TITLE, readOnlyHint: true, openWorldHint: false },
      description:
        'Lists cards the signed-in user already holds, without searching for a word. Use it for ' +
        '"give me ten random words from my deck", "what have I added lately?", "what should I ' +
        'review today?" and "which words do I keep forgetting?". `selection` picks which cards ' +
        'come back: `random` for a fresh draw every call, `newest` or `oldest` by when they ' +
        "added the card, `due` for today's review session (the cards due by the end of their " +
        'day, then a few they have never reviewed, the same session the app would deal), ' +
        '`struggling` for the ones ' +
        `they have forgotten most often in review. Returns up to ${DECK_BROWSE_MAX_COUNT} cards ` +
        'with cardId, word, definition, which deck holds it, a link to the word page on ' +
        'inoh.app, and `isPrivate` — true for a card the user made, so describe it as theirs ' +
        'rather than as an Inoh entry, and remember only those can be deleted or remade. Pass a ' +
        'cardId to remove_card_from_deck or update_private_card to act on one. Reading the deck ' +
        'this way never changes a card or its review schedule; when they review, quiz them ' +
        'and record each answer with record_review. search_deck is what answers whether they ' +
        'hold one particular word.',
      inputSchema: {
        selection: z
          .enum(['random', 'newest', 'oldest', 'due', 'struggling'])
          .default('random')
          .describe('Which cards to take. Omit for a random handful.'),
        count: z
          .number()
          .int()
          .min(1)
          .max(DECK_BROWSE_MAX_COUNT)
          .default(DECK_BROWSE_DEFAULT_COUNT)
          .describe('How many cards to take, e.g. 10'),
        deckName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Name of one deck to read. Omit to take from every deck they have.'),
      },
    },
    async ({ selection, count, deckName }, extra) => {
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));
      const decks = await fetchDecks(supabase);

      const chosenDeck = deckName === undefined ? undefined : findDeckByName(decks, deckName);
      if (deckName !== undefined && chosenDeck === undefined) {
        return buildToolError(
          `No deck named "${deckName}". Your decks: ${listDeckNames(decks)}. ` +
            'Omit deckName to take from all of them.',
        );
      }

      const { cards, moreDueTodayCount } = await browseDeckCards(supabase, {
        selection,
        count,
        deckId: chosenDeck?.id,
      });
      const results = cards.map((card) => toDeckCardResult(card, decks));
      const scope =
        chosenDeck === undefined ? 'any of their decks' : `their "${chosenDeck.name}" deck`;

      if (results.length === 0) {
        return { content: [{ type: 'text', text: DESCRIBE_EMPTY_RESULT[selection](scope) }] };
      }

      const capNote =
        moreDueTodayCount !== undefined
          ? _describeMoreDueToday(moreDueTodayCount)
          : results.length === count
            ? ' That is as many as they asked for; there may be more.'
            : '';

      return {
        content: [
          {
            type: 'text',
            text:
              `${results.length} card(s) from ${scope}, ${SELECTION_SUMMARIES[selection]}.` +
              `${capNote}\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    },
  );
};
