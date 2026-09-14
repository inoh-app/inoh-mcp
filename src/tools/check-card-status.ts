import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getUserAccessToken } from '../auth/index.js';
import {
  CARD_REQUEST_COLUMNS,
  describeCardRequestStatus,
  describeLowAllowance,
  fetchPrivateCardQuota,
  toCardRequestStatus,
  type CardRequestDestination,
  type CardRequestRow,
} from '../card-requests/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';

/** How many recent requests to report when no specific one is named. */
const RECENT_REQUEST_LIMIT = 5;

/**
 * Say that there is nothing to report, in terms of what was asked for.
 *
 * @param requestId - The request that was named, when one was
 * @param destination - The dictionary the question was narrowed to, if any
 * @returns The message to hand back
 */
const _describeNothingFound = (
  requestId: string | undefined,
  destination: CardRequestDestination | undefined,
): string => {
  if (requestId !== undefined) {
    return `No card request found with id ${requestId}. It may belong to another account.`;
  }
  if (destination === 'public') {
    return (
      'This user has not suggested any words for the public dictionary. ' +
      'request_public_card is how they would.'
    );
  }
  if (destination === 'private') {
    return 'This user has not created any private cards yet. Use create_private_card to make one.';
  }
  return (
    'This user has not asked Inoh for any cards yet. create_private_card makes one for them ' +
    'alone; request_public_card suggests a word for the dictionary everyone shares.'
  );
};

/**
 * Registers a `check_card_status` tool that reports how the cards a user asked
 * for are coming along, in either dictionary.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerCheckCardStatusTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'check_card_status',
    {
      title: 'Card request status',
      description:
        'Reports how the cards the signed-in user asked Inoh for are coming along, both the ' +
        'private ones they made for themselves and the words they suggested for the public ' +
        'dictionary. Each entry says which it is in `destination`, and where it has got to in ' +
        '`progress`: `generating`, then `ready` (a private card in their deck, with a link) ' +
        'or, for a suggestion, `with_a_reviewer` and then `published` or `declined`; ' +
        '`failed` carries the reason. A `redoOfCardId` means that entry is remaking a card ' +
        'they already had rather than adding a new one. Pass the requestId from ' +
        'create_private_card, update_private_card or request_public_card to check one, or ' +
        'omit it for their most recent requests. A private card normally takes under a ' +
        'minute, so if one is still generating it is worth waiting a moment before checking ' +
        'again; a suggestion waits on a person and can sit with a reviewer for days, so ' +
        'checking it repeatedly tells you nothing.',
      inputSchema: {
        requestId: z
          .string()
          .uuid()
          .optional()
          .describe(
            'The requestId returned by create_private_card, update_private_card or ' +
              'request_public_card. Omit to list recent requests.',
          ),
        destination: z
          .enum(['private', 'public'])
          .optional()
          .describe(
            'Narrow the list to one kind: `private` for cards the user made for themselves, ' +
              '`public` for words they suggested for the shared dictionary. Omit for both.',
          ),
      },
    },
    async ({ requestId, destination }, extra) => {
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      // RLS restricts card_requests to the caller's own rows, so no user filter
      // is needed here; asking for someone else's id simply finds nothing.
      //
      // Drafts are left out: a draft is a word written down in the app's
      // Generate composer and not asked for yet, so it holds no allowance, is
      // invisible to the generator, and would otherwise read as generating
      // forever. The app's My Requests screen filters them out for the same
      // reason.
      let query = supabase
        .from('card_requests')
        .select(CARD_REQUEST_COLUMNS)
        .neq('status', 'draft');

      if (destination !== undefined) {
        query = query.eq('destination', destination);
      }

      query =
        requestId === undefined
          ? query.order('created_at', { ascending: false }).limit(RECENT_REQUEST_LIMIT)
          : query.eq('id', requestId);

      const { data, error } = await query;

      if (error) {
        throw new Error(`Could not read card status: ${error.message}`);
      }

      const statuses = ((data ?? []) as CardRequestRow[]).map(toCardRequestStatus);
      const [firstStatus] = statuses;

      if (firstStatus === undefined) {
        return {
          content: [{ type: 'text', text: _describeNothingFound(requestId, destination) }],
        };
      }

      const summary =
        requestId === undefined
          ? `${statuses.length} most recent request(s).`
          : describeCardRequestStatus(firstStatus);

      // Reason: read only to decide whether the allowance is worth raising, and
      // only when private cards are in view at all — a question about
      // suggestions is no place to bring the private allowance up. The tally is
      // deliberately not reported every time either; see describeLowAllowance.
      const lowAllowanceNote =
        destination === 'public'
          ? null
          : describeLowAllowance(await fetchPrivateCardQuota(supabase));

      return {
        content: [
          {
            type: 'text',
            text:
              `${summary}\n${JSON.stringify(statuses, null, 2)}` +
              `${lowAllowanceNote === null ? '' : `\n\n${lowAllowanceNote}`}`,
          },
        ],
      };
    },
  );
};
