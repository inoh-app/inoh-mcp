import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as z from 'zod/v4';
import { getAuthenticatedUser, getUserAccessToken } from '../auth/index.js';
import { MAX_WORD_LENGTH } from '../constants.js';
import {
  buildDefaultContext,
  cardContextSchema,
  describeCardRequestInsertError,
  describeLowAllowance,
  fetchPrivateCardQuota,
} from '../card-requests/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { buildCardChoiceQuestion, requireOneCardSelector } from './card-selection.js';
import { lookupOwnCard, type OwnCardLookup } from './own-card-lookup.js';
import { buildToolError } from './tool-result.js';

/**
 * Say why no card could be redone, and what to do about it.
 *
 * @param lookup - A lookup result other than `found`
 * @returns The explanation to hand back to the caller
 */
const _describeUnredoableCard = (lookup: Exclude<OwnCardLookup, { kind: 'found' }>): string => {
  switch (lookup.kind) {
    case 'noCardWithId':
      return `There is no card with id ${lookup.cardId} on this account.`;
    case 'publicCard':
      return (
        `"${lookup.card.word}" is a card from the public Inoh dictionary, which belongs to ` +
        "everyone, so it cannot be redone. Only cards in the user's own private dictionary " +
        'can be.'
      );
    case 'noCardForWord':
      return (
        `The user has no private card for "${lookup.word}". Only cards they created with ` +
        'create_private_card can be redone. If the public dictionary has a card for the word, ' +
        'add_card_to_deck is what they want instead.'
      );
    case 'severalCardsForWord':
      return (
        `The user has ${lookup.cards.length} private cards for "${lookup.word}". ` +
        buildCardChoiceQuestion(lookup.cards)
      );
  }
};

/**
 * The sense the card was last made with.
 *
 * Reason: a redo with no new context should teach the same sense again rather
 * than drift to the dictionary meaning, and the sense lives on the request that
 * produced the card, not on the card. The newest wins, so a card redone twice
 * keeps the context from its latest version.
 */
const _readLastContext = async (
  supabase: SupabaseClient,
  cardId: string,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('card_requests')
    .select('context')
    .eq('dictionary_id', cardId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read what that card was made from: ${error.message}`);
  }

  return (data as { context: string } | null)?.context ?? null;
};

const TOOL_TITLE = 'Update a card you made';

/**
 * Registers an `update_private_card` tool that regenerates one of the signed-in
 * user's own cards in place, keeping its review history.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerUpdatePrivateCardTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'update_private_card',
    {
      title: TOOL_TITLE,
      annotations: {
        title: TOOL_TITLE,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Remakes a card the signed-in user created with create_private_card, when it came out ' +
        'wrong: a definition that misses the sense they meant, a flat example sentence, an ' +
        'unhelpful image. Inoh builds the card over again and writes it over the same card, ' +
        'so the card keeps its place in the deck and all of its review progress — unlike ' +
        "deleting and making a new one, which starts the user's memory of the word over. It " +
        'is the whole card or nothing: everything except the word itself descends from the ' +
        'word and the sense, so no single part of it can be redone on its own. That last ' +
        'constraint is for you and not for the user: offer the redo, and leave out which ' +
        'parts of the card get built again. Give `context` to say which sense to teach; ' +
        'without it the card is simply made again from the sense it already had. Identify the ' +
        'card by `word` or by `cardId`. This only works on cards the user made: a card from ' +
        'the shared Inoh dictionary belongs to everyone. To teach a different word, delete ' +
        'this card and create one for that word instead. Takes about a minute and finishes in ' +
        'the background; call check_card_status to check on it. Counts as one card ' +
        "against the user's monthly allowance, because it generates a new image.",
      inputSchema: {
        word: z
          .string()
          .trim()
          .min(1)
          .max(MAX_WORD_LENGTH)
          .optional()
          .describe('The word on the card to redo, e.g. "runway". Use this or cardId.'),
        cardId: z
          .string()
          .uuid()
          .optional()
          .describe('The cardId from check_card_status. Use this or word.'),
        context: cardContextSchema.describe(
          'Which sense the card should teach this time, e.g. "months of cash a startup ' +
            'has left, not the airport kind". Omit to remake the card from the sense it ' +
            'already had, which is what to do when the sense was right but the wording, ' +
            'sentence or image was not.',
        ),
      },
    },
    async ({ word, cardId, context }, extra) => {
      const selectorProblem = requireOneCardSelector(word, cardId);
      if (selectorProblem !== null) {
        return buildToolError(selectorProblem);
      }

      const user = getAuthenticatedUser(extra.authInfo);
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      const lookup = await lookupOwnCard(supabase, word, cardId);
      if (lookup.kind !== 'found') {
        return buildToolError(_describeUnredoableCard(lookup));
      }
      const { card } = lookup;

      const sense =
        context ?? (await _readLastContext(supabase, card.id)) ?? buildDefaultContext(card.word);

      const { data, error } = await supabase
        .from('card_requests')
        .insert({
          user_id: user.id,
          // Reason: the card's own spelling, not the caller's. The database
          // refuses a draft whose word does not match the card being rewritten.
          word: card.word,
          context: sense,
          destination: 'private',
          source: 'mcp',
          target_dictionary_id: card.id,
        })
        .select('id')
        .single();

      if (error) {
        const explanation = describeCardRequestInsertError(
          error,
          `"${card.word}" is already being remade. Call check_card_status to see how ` +
            'it is going, and wait for it to finish before asking for another.',
        );
        if (explanation !== null) {
          return buildToolError(explanation);
        }
        throw new Error(`Could not start the redo: ${error.message}`);
      }

      // Reason: read only to decide whether the allowance is worth raising. The
      // tally is deliberately not reported on every card — see describeLowAllowance.
      const lowAllowanceNote = describeLowAllowance(await fetchPrivateCardQuota(supabase));

      return {
        content: [
          {
            type: 'text',
            text:
              `Remaking the card for "${card.word}". It usually takes under a minute. The card ` +
              'keeps its id, its place in the deck and all of its review progress.\n\n' +
              `${JSON.stringify(
                {
                  requestId: data.id,
                  word: card.word,
                  cardId: card.id,
                  context: sense,
                  status: 'generating',
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
