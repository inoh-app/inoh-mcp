import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getUserAccessToken } from '../auth/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { buildCardChoiceQuestion, requireOneCardSelector } from './card-selection.js';
import { lookupOwnCard, type OwnCardLookup } from './own-card-lookup.js';
import { buildToolError } from './tool-result.js';

/** The edge function that owns deletion: the row, its deck rows, and its media. */
const DELETE_PRIVATE_CARD_FUNCTION = 'delete-private-card';

/** What the function answers with when it refuses or fails. */
interface DeletePrivateCardResponse {
  error?: string;
}

/**
 * The reason the function gave for refusing, if it gave one.
 *
 * Reason: supabase-js turns any non-2xx into an error whose message is only
 * "Edge Function returned a non-2xx status code", and hangs the real response
 * off `context`. The function's own message is the useful one — "Card not
 * found. It may already have been deleted." — so it is read back out here
 * rather than thrown away.
 *
 * The response is recognised by having a `json()` rather than by
 * `instanceof Response`: this package compiles against `lib: ES2022` with only
 * Node types, where that global is not guaranteed to be a type.
 *
 * @param error - What functions.invoke returned
 * @returns The function's message, or null when this was not a refusal
 */
const _readRefusal = async (error: unknown): Promise<string | null> => {
  const { context } = error as { context?: { json?: () => Promise<unknown> } };
  if (typeof context?.json !== 'function') return null;

  try {
    const body = (await context.json()) as DeletePrivateCardResponse;
    return body.error ?? null;
  } catch {
    return null;
  }
};

/**
 * Say why no card could be deleted, and what to do about it.
 *
 * @param lookup - A lookup result other than `found`
 * @returns The explanation to hand back to the caller
 */
const _describeUndeletableCard = (lookup: Exclude<OwnCardLookup, { kind: 'found' }>): string => {
  switch (lookup.kind) {
    case 'noCardWithId':
      return `There is no card with id ${lookup.cardId} on this account.`;
    case 'publicCard':
      return (
        `"${lookup.card.word}" is a card from the public Inoh dictionary, which belongs to ` +
        "everyone, so it cannot be deleted. Only cards in the user's own private dictionary " +
        'can be. Taking this one out of the deck is the thing to offer instead — say it as ' +
        `"I can take ${lookup.card.word} out of your deck", and call remove_card_from_deck.`
      );
    case 'noCardForWord':
      return (
        `The user has no card of their own for "${lookup.word}". Only cards they made with ` +
        'create_private_card can be deleted; a card from the public dictionary leaves a deck ' +
        `through remove_card_from_deck instead, which the user hears as taking "${lookup.word}" ` +
        'out of their deck.'
      );
    case 'severalCardsForWord':
      return (
        `The user has ${lookup.cards.length} cards of their own for "${lookup.word}". ` +
        buildCardChoiceQuestion(lookup.cards)
      );
  }
};

/**
 * Registers a `delete_private_card` tool that destroys one of the signed-in
 * user's own cards for good.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerDeletePrivateCardTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'delete_private_card',
    {
      title: 'Delete a card you made',
      description:
        'Destroys a card the signed-in user made with create_private_card: it leaves their ' +
        'private dictionary and every deck, and its image and audio are deleted. This is ' +
        'permanent — there is no undo, and remaking the word later spends another card of the ' +
        'monthly allowance and starts its review progress over. So confirm with the user ' +
        'before calling it, in terms of the card and the word ("that would delete your runway ' +
        'card for good — sure?"), never by naming a tool. Identify the card by `word`, or by ' +
        '`cardId` from check_card_status. Two gentler things are usually what they ' +
        'actually want: remove_card_from_deck stops a card coming up in reviews but keeps it ' +
        'in their private dictionary, ready to add back; and update_private_card remakes a bad ' +
        'card in place, keeping its review progress. Only cards the user made can be deleted — ' +
        'a card from the public Inoh dictionary belongs to everyone.',
      inputSchema: {
        word: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('The word on the card to delete, e.g. "runway". Use this or cardId.'),
        cardId: z
          .string()
          .uuid()
          .optional()
          .describe('The cardId from check_card_status. Use this or word.'),
      },
    },
    async ({ word, cardId }, extra) => {
      const selectorProblem = requireOneCardSelector(word, cardId);
      if (selectorProblem !== null) {
        return buildToolError(selectorProblem);
      }

      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      const lookup = await lookupOwnCard(supabase, word, cardId);
      if (lookup.kind !== 'found') {
        return buildToolError(_describeUndeletableCard(lookup));
      }
      const { card } = lookup;

      // Reason: the media lives in Storage, which only the service role may
      // write, so a client-side delete would always leave the image and three
      // audio clips behind. The edge function is the one path that cannot
      // forget them, and it re-checks ownership itself.
      const { error } = await supabase.functions.invoke<DeletePrivateCardResponse>(
        DELETE_PRIVATE_CARD_FUNCTION,
        { body: { dictionary_id: card.id } },
      );

      if (error) {
        const refusal = await _readRefusal(error);
        if (refusal !== null) {
          return buildToolError(refusal);
        }
        throw new Error(`Could not delete the card: ${error.message}`);
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Deleted the card for "${card.word}". It is gone from the user's private ` +
              'dictionary and every deck, along with its image and audio, and cannot be ' +
              'brought back.\n\n' +
              'If they change their mind, create_private_card can make a fresh card for the ' +
              'same word — a new card, spending another of the monthly allowance, with review ' +
              'progress starting over. Offer that in those words, never by naming a tool.',
          },
        ],
      };
    },
  );
};
