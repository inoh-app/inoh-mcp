/**
 * Reviewing through an AI client: each answer is recorded as it is given, the
 * card leaves today's session, and the review counts toward the streak the
 * same way one in the app does.
 *
 * Needs the local edge functions served: recording goes through
 * record-review, the function the app uses too.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import {
  connectWithToken,
  jsonOf,
  signInWithEmailCode,
  textOf,
  type McpConnection,
  type SignedInSession,
} from '../session.js';

interface SessionCard {
  cardId: string;
  word: string;
}

let server: RunningServer;
let connection: McpConnection;
let session: SignedInSession;

/** Today's review session, as the AI client is handed it. */
async function fetchSession(): Promise<SessionCard[]> {
  const result = await connection.callTool('browse_deck', { selection: 'due', count: 20 });
  expect(result.isError).not.toBe(true);
  return textOf(result).startsWith('Nothing') ? [] : jsonOf<SessionCard[]>(result);
}

/** The streak as the backend holds it. */
async function readCurrentStreak(): Promise<number> {
  const { data, error } = await session.supabase
    .from('user_session_streaks')
    .select('current_streak')
    .single<{ current_streak: number }>();
  expect(error).toBeNull();
  return data?.current_streak ?? 0;
}

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'learner' });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
});

afterAll(async () => {
  await connection?.close();
  await server?.close();
});

describe('recording an answer', () => {
  it('saves it and takes the card out of today’s session', async () => {
    const [firstCard] = await fetchSession();

    const result = await connection.callTool('record_review', {
      cardId: firstCard?.cardId,
      recall: 'partly_remembered',
    });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('Recorded.');
    const remaining = await fetchSession();
    expect(remaining.map((card) => card.cardId)).not.toContain(firstCard?.cardId);
  });

  it('writes the review into the history, as coming from an AI client', async () => {
    const { data, error } = await session.supabase.from('review_logs').select('source, quiz_type');

    expect(error).toBeNull();
    expect(data).toEqual([{ source: 'mcp', quiz_type: null }]);
  });

  it('refuses a card that is not in their deck', async () => {
    const result = await connection.callTool('record_review', {
      cardId: randomUUID(),
      recall: 'remembered',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not in any of their decks');
  });
});

describe('finishing the day', () => {
  it('says the day is done once every card is reviewed, and extends the streak', async () => {
    const streakBefore = await readCurrentStreak();

    for (const card of await fetchSession()) {
      const result = await connection.callTool('record_review', {
        cardId: card.cardId,
        recall: 'remembered',
      });
      expect(result.isError).not.toBe(true);
    }

    const result = await connection.callTool('browse_deck', { selection: 'due' });
    expect(textOf(result)).toContain('That is the day done');
    // Reason: the learner deck is five cards, well under the fifteen a streak
    // day asks for, so this is the "nothing left today" half of the rule. The
    // fixture's streak last counted yesterday, so today's makes it one longer.
    expect(await readCurrentStreak()).toBe(streakBefore + 1);
  });
});
