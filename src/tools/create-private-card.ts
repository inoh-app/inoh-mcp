import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getAuthenticatedUser, getUserAccessToken } from '../auth/index.js';
import {
  buildDefaultContext,
  cardContextSchema,
  cardWordSchema,
  describeCardRequestInsertError,
  describeLowAllowance,
  fetchPrivateCardQuota,
} from '../card-requests/index.js';
import { describeMissingDeck, fetchDecks, findDeckByName } from '../decks/index.js';
import { findExistingCards, type DictionaryCard } from '../dictionary/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { MY_REQUESTS_URL } from '../web-app-urls.js';
import { formatCardChoices } from './card-selection.js';
import { buildToolError } from './tool-result.js';

/**
 * Explain that the word is already covered, and what to do instead.
 *
 * Reason: generating a duplicate spends a slot of the monthly allowance on a
 * worse copy of a card that already exists, and nothing reviews the result. The
 * tool description has always asked callers to search first, but an instruction
 * a model can skip is not a safeguard, so the check belongs here.
 *
 * @param word - The word that was requested
 * @param existingCards - What the dictionary already holds for it
 * @returns A message telling the caller how to proceed
 */
const _describeExistingCards = (word: string, existingCards: DictionaryCard[]): string => {
  const publicCards = existingCards.filter((card) => card.owner_user_id === null);
  const ownCards = existingCards.filter((card) => card.owner_user_id !== null);

  const paragraphs: string[] = [];

  if (publicCards.length > 0) {
    paragraphs.push(
      `The public Inoh dictionary already has ${publicCards.length === 1 ? 'a card' : `${publicCards.length} cards`} ` +
        `for "${word}". A public dictionary card is written and checked by Inoh, and adding one ` +
        'costs nothing against the monthly allowance. Offer them to the user by what they mean, ' +
        `not by id:\n${formatCardChoices(publicCards)}`,
    );
  }

  if (ownCards.length > 0) {
    paragraphs.push(
      `The user's private dictionary already has ${ownCards.length === 1 ? 'a card' : `${ownCards.length} cards`} ` +
        `for "${word}":\n${formatCardChoices(ownCards)}`,
    );
  }

  if (ownCards.length > 0) {
    paragraphs.push(
      'If the card they already made is simply not good enough — wrong sense, dull sentence, ' +
        'unhelpful image — remaking it in place keeps its review progress, which is almost ' +
        'always what they want instead of a second card for the same word. ' +
        `update_private_card does that; to the user it is "I can remake your ${word} card".`,
    );
  }

  paragraphs.push(
    'Adding one of those is what to do instead, which add_card_to_deck does. If the user ' +
      'genuinely wants a separate card because they mean a different sense of the word, call ' +
      'create_private_card again with createAnyway set to true and a `context` saying which ' +
      'sense.',
  );

  return paragraphs.join('\n\n');
};

/**
 * Registers a `create_private_card` tool that generates a full Inoh card for the
 * signed-in user and adds it to their deck.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerCreatePrivateCardTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'create_private_card',
    {
      title: 'Create a private card',
      description:
        'Creates a full Inoh flashcard for a word or phrase and adds it to the signed-in ' +
        "user's deck. The card goes into their private dictionary, which only they can see, " +
        'never into the public Inoh dictionary. Inoh generates everything needed to quiz on it — definition, ' +
        'example sentence, pronunciation audio, image, phonetic and quiz distractors — so ' +
        'this takes about a minute and finishes in the background. Call ' +
        'check_card_status to check on it. If the Inoh dictionary already has the ' +
        'word — or the user already made one for it — this stops and points at that card ' +
        'rather than making a duplicate, since a public dictionary card is better and costs no ' +
        'allowance. Each plan allows a set ' +
        'number of private cards per month. Inoh only generates English cards, so `word` has ' +
        'to be English — but the user can ask in any language, and `context` can be written ' +
        'in whatever language they used.',
      inputSchema: {
        word: cardWordSchema.describe(
          'The word or phrase the card teaches, e.g. "runway" or "spill the beans". Must be ' +
            'an English word: Inoh only generates English cards.',
        ),
        context: cardContextSchema.describe(
          'Which sense of the word to teach, e.g. "months of cash a startup has left, not ' +
            'the airport kind". Strongly recommended for words with several meanings, since ' +
            'nobody reviews the result before it reaches the user. May be in any language — ' +
            "no need to translate the user's own words.",
        ),
        deckName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Name of an existing deck to file the card in. Defaults to the user's first deck.",
          ),
        createAnyway: z
          .boolean()
          .optional()
          .describe(
            'Set true to generate a card even though Inoh already has this sense. Rarely ' +
              'needed for a public entry: that half of the check compares meanings, not ' +
              'spellings, so a sense the dictionary does not cover goes through without it. ' +
              "The user's own cards are matched on the word, so a second sense of one of " +
              'those does need it.',
          ),
      },
    },
    async ({ word, context, deckName, createAnyway }, extra) => {
      const user = getAuthenticatedUser(extra.authInfo);
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      if (createAnyway !== true) {
        // Reason: a card the user owns counts whether or not it is in a deck.
        // A private card sitting outside every deck is still theirs, still in
        // their private dictionary, and still what they should be offered
        // rather than a second copy bought with the monthly allowance.
        const { publicCards, ownCards } = await findExistingCards(supabase, word, context);
        const existingCards = [...publicCards, ...ownCards];
        if (existingCards.length > 0) {
          return buildToolError(_describeExistingCards(word, existingCards));
        }
      }

      // Left null when no deck is named: publish_private_card resolves the
      // default server-side, which is one fewer round trip than doing it here.
      let deckId: string | null = null;
      if (deckName !== undefined) {
        const decks = await fetchDecks(supabase);
        const deck = findDeckByName(decks, deckName);
        if (deck === undefined) {
          return buildToolError(describeMissingDeck(deckName, decks));
        }
        deckId = deck.id;
      }

      const { data, error } = await supabase
        .from('card_requests')
        .insert({
          user_id: user.id,
          word,
          context: context ?? buildDefaultContext(word),
          destination: 'private',
          source: 'mcp',
          deck_id: deckId,
        })
        .select('id')
        .single();

      if (error) {
        const explanation = describeCardRequestInsertError(
          error,
          `A card for "${word}" with that same context is already being made. ` +
            'Call check_card_status to see how it is going.',
        );
        if (explanation !== null) {
          return buildToolError(explanation);
        }
        throw new Error(`Could not start the card: ${error.message}`);
      }

      // Reason: read only to decide whether the allowance is worth raising. The
      // tally is deliberately not reported on every card — see describeLowAllowance.
      const lowAllowanceNote = describeLowAllowance(await fetchPrivateCardQuota(supabase));

      return {
        content: [
          {
            type: 'text',
            text:
              `Making a card for "${word}". It usually takes under a minute, and lands in the ` +
              `user's deck ready to quiz.\n\n` +
              `${JSON.stringify(
                {
                  requestId: data.id,
                  word,
                  status: 'generating',
                  trackAt: MY_REQUESTS_URL,
                },
                null,
                2,
              )}\n\n` +
              'Call check_card_status with this requestId to check whether it is ready.' +
              `${lowAllowanceNote === null ? '' : `\n\n${lowAllowanceNote}`}`,
          },
        ],
      };
    },
  );
};
