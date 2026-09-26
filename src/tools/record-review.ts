import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { getUserAccessToken } from '../auth/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { readEdgeFunctionRefusal, type EdgeFunctionRefusal } from './edge-function-refusal.js';
import { buildToolError } from './tool-result.js';

/** The edge function that grades a review and schedules the card's next one. */
const RECORD_REVIEW_FUNCTION = 'record-review';

/** How well the learner recalled the card. record-review grades these Good, Hard and Again. */
const RECALL_OUTCOMES = ['remembered', 'partly_remembered', 'forgot'] as const;

/**
 * What to tell the model when record-review refused.
 *
 * @param refusal - The function's refusal body
 * @returns The explanation to hand back, with what to do next
 */
const _describeRefusal = (refusal: EdgeFunctionRefusal): string => {
  switch (refusal.code) {
    case 'CARD_NOT_IN_DECK':
      return (
        'That card is not in any of their decks, so there is no review progress to record. ' +
        'Only cards from their deck can be reviewed.'
      );
    default:
      return refusal.error ?? 'The review could not be recorded.';
  }
};

const TOOL_TITLE = 'Record a review answer';

/**
 * Registers a `record_review` tool that saves how well the user recalled one
 * card, which moves it along its review schedule.
 *
 * Reason: without it, reviewing in an AI client changed nothing. The same
 * words came back as due the next day, and the app never knew the review had
 * happened. The grading and scheduling happen in the record-review edge
 * function, the same one the app uses, so a review here counts exactly like a
 * review there: the streak and the card's next due date.
 *
 * @param server - The MCP server to register the tool on
 * @param connection - Supabase project URL and publishable key
 */
export const registerRecordReviewTool = (
  server: McpServer,
  connection: SupabaseConnection,
): void => {
  server.registerTool(
    'record_review',
    {
      title: TOOL_TITLE,
      annotations: {
        title: TOOL_TITLE,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Saves how well the signed-in user recalled one card while reviewing, which schedules ' +
        'when they see it next, exactly as a review in the Inoh app would. Call it once per ' +
        'card, after replying to their answer and before asking the next card, not in a batch ' +
        'at the end, so nothing is lost if the conversation stops. Only call it after they ' +
        'actually tried to recall the card; ' +
        'listing, explaining or talking about a word is not a review. Ask however suits the ' +
        'conversation: say the word and ask what it means, give the meaning and ask for the ' +
        'word, or use it in a sentence. Then judge their answer: `remembered` when they had ' +
        'it; `partly_remembered` when they got half of it, needed a hint, or were slow and ' +
        'unsure; `forgot` when they did not know it or got it wrong. When unsure between two, ' +
        'pick the lower one. When they missed it or only partly had it, tell them the right ' +
        'answer and give them something that makes it stick. Think about what would work ' +
        'best for this word and this learner: etymology, an everyday example sentence, ' +
        'similar or opposite words and a mnemonic are ideas, not a list to pick from, so use ' +
        'your own if it fits better. Keep it to a line or two. Then record the review and ' +
        'move to the next card. ' +
        'There is no need to tell them when they will see a card again. ' +
        "Take cards from browse_deck with selection `due`, which is today's session.",
      inputSchema: {
        cardId: z.string().uuid().describe('The cardId of the card they just answered.'),
        recall: z
          .enum(RECALL_OUTCOMES)
          .describe('How well they recalled it: remembered, partly_remembered or forgot.'),
      },
    },
    async ({ cardId, recall }, extra) => {
      const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));

      const { error } = await supabase.functions.invoke(RECORD_REVIEW_FUNCTION, {
        // Reason: one call is one answer, so each gets its own id. The
        // server's duplicate check cannot tell a model that calls twice for
        // one answer from two answers; the description is what guards that.
        body: { dictionary_id: cardId, review_id: randomUUID(), source: 'mcp', recall },
      });

      if (error) {
        const refusal = await readEdgeFunctionRefusal(error);
        if (refusal !== null) {
          return buildToolError(_describeRefusal(refusal));
        }
        throw new Error(`Could not record the review: ${error.message}`);
      }

      // Reason: the next review date is left out on purpose. Handed a date,
      // the model announced it after every answer ("It comes back tomorrow"),
      // which the learner does not need; the app keeps the schedule for them.
      return { content: [{ type: 'text', text: 'Recorded.' }] };
    },
  );
};
