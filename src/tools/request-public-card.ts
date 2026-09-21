import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getAuthenticatedUser, getUserAccessToken } from '../auth/index.js';
import {
  buildDefaultContext,
  cardContextSchema,
  cardWordSchema,
  describeCardRequestInsertError,
} from '../card-requests/index.js';
import { findExistingCards, type DictionaryCard } from '../dictionary/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { MY_REQUESTS_URL } from '../web-app-urls.js';
import { formatCardChoices } from './card-selection.js';
import { buildToolError } from './tool-result.js';

/**
 * Explain that the public dictionary already covers the word.
 *
 * Reason: a suggestion for a word Inoh already has costs a reviewer's
 * attention and ends in a decline, and the user's actual want — the word in
 * their deck — is already one call away.
 *
 * @param word - The word that was suggested
 * @param publicCards - What the public dictionary already holds for it
 * @returns A message telling the caller how to proceed
 */
const _describeExistingPublicCards = (word: string, publicCards: DictionaryCard[]): string =>
  `The public Inoh dictionary already has ${publicCards.length === 1 ? 'a card' : `${publicCards.length} cards`} ` +
  `for "${word}", so there is nothing to contribute. Offer them to the user by what they ` +
  `mean, not by id:\n${formatCardChoices(publicCards)}\n\n` +
  'Putting one of those in their deck is what to do instead, which add_card_to_deck does. If ' +
  'the user means a sense none of those cover, call request_public_card again with ' +
  'requestAnyway set to true and a `context` saying which sense.';

/**
 * Registers a `request_public_card` tool that offers a word to the public Inoh
 * dictionary, where a reviewer decides whether it is published for everyone.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerRequestPublicCardTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'request_public_card',
    {
      title: 'Request a card for the public dictionary',
      description:
        'Asks Inoh to add a word to the public dictionary, the one every Inoh user shares. ' +
        'This is how a user contributes: Inoh builds the card, then a person at Inoh reads it ' +
        'before anything is published, so it is not instant — expect days rather than a ' +
        'minute — and it can be turned down. If it is published, the card belongs to ' +
        "everyone, and it also lands in the requester's own deck. It costs nothing: public " +
        'requests are unlimited on every plan and spend none of the monthly private-card ' +
        'allowance. Use it when the dictionary is missing a word that belongs in it, which ' +
        'search_dictionary is what establishes. When the user just wants the word in their ' +
        'own deck now, create_private_card is the right tool instead — it takes about a ' +
        'minute and nobody has to approve it. Offer this one when they say the dictionary ' +
        'ought to have a word, or ask how to contribute; do not quietly send a suggestion off ' +
        'to review when someone asked for a card of their own. Inoh only generates English ' +
        'cards, so `word` has to be English — but the user can ask in any language, and ' +
        '`context` can be written in whatever language they used.',
      inputSchema: {
        word: cardWordSchema.describe(
          'The word or phrase to add to the public dictionary, e.g. "enshittification". Must ' +
            'be an English word: Inoh only generates English cards.',
        ),
        context: cardContextSchema.describe(
          'Which sense of the word the entry should teach, e.g. "a platform getting worse as ' +
            'it squeezes its users for profit". Strongly recommended: it is what the reviewer ' +
            'judges the card against, and it is what the duplicate check compares, so giving ' +
            'it is what lets a second sense of a word Inoh already has through. Without it ' +
            'the check falls back to matching the word alone. May be in any language — no ' +
            "need to translate the user's own words.",
        ),
        requestAnyway: z
          .boolean()
          .optional()
          .describe(
            'Set true to suggest a word the public dictionary already has this sense of. ' +
              'Rarely needed: the check compares meanings, not spellings, so a sense the ' +
              'dictionary does not cover already goes through without it.',
          ),
      },
    },
    async ({ word, context, requestAnyway }, extra) => {
      const user = getAuthenticatedUser(extra.authInfo);
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      if (requestAnyway !== true) {
        // Reason: only the public dictionary's own entries are a reason to
        // stop. A private card the user made for the word is theirs alone —
        // nobody else can see it, so the word is still missing from the
        // dictionary and still worth suggesting.
        //
        // Matched on what the entry teaches rather than on its spelling, the
        // same way the app and the Raycast extension do it, so a word the
        // dictionary carries in one sense can still be suggested in another.
        const { publicCards } = await findExistingCards(supabase, word, context);
        if (publicCards.length > 0) {
          return buildToolError(_describeExistingPublicCards(word, publicCards));
        }
      }

      const { data, error } = await supabase
        .from('card_requests')
        .insert({
          user_id: user.id,
          word,
          context: context ?? buildDefaultContext(word),
          destination: 'public',
          // Reason: a public request does not have to say which client sent
          // it, and the value never reaches the dictionary — approve_card_request
          // does not copy it, so published entries keep their null source. It
          // is recorded anyway, because knowing which clients people
          // contribute from is worth having.
          source: 'mcp',
          // deck_id is deliberately left unset: it is ignored for a public
          // request, which lands in the requester's default deck on approval.
        })
        .select('id')
        .single();

      if (error) {
        const explanation = describeCardRequestInsertError(
          error,
          `The user has already suggested "${word}" for the public dictionary with that same ` +
            'meaning, and it is still being looked at. Call check_card_status to see where it ' +
            'has got to.',
        );
        if (explanation !== null) {
          return buildToolError(explanation);
        }
        throw new Error(`Could not send the suggestion: ${error.message}`);
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Suggested "${word}" for the public Inoh dictionary. Someone at Inoh reads every ` +
              'suggestion before it is published, so this takes days rather than minutes, and ' +
              "it may be declined. If it is published, the card joins everyone's dictionary " +
              `and lands in the user's deck.\n\n` +
              `${JSON.stringify(
                {
                  requestId: data.id,
                  word,
                  destination: 'public',
                  status: 'generating',
                  trackAt: MY_REQUESTS_URL,
                },
                null,
                2,
              )}\n\n` +
              'Call check_card_status with this requestId to see where it has got to. If the ' +
              'user wants the word in their deck today rather than whenever a reviewer gets ' +
              'to it, create_private_card makes them one in about a minute.',
          },
        ],
      };
    },
  );
};
