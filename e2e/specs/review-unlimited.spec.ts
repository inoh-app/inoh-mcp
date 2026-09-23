/** Reviews through MCP keep saving beyond the former daily cap on every plan. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import { connectWithToken, jsonOf, signInWithEmailCode, textOf } from '../session.js';

interface SessionCard {
  cardId: string;
}

let server: RunningServer;

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
});

afterAll(async () => {
  await server?.close();
});

for (const plan of ['free', 'plus', 'pro'] as const) {
  it(`records the ${plan} account's 51st review and keeps its history and streak`, async () => {
    resetAccount({ email: TEST_ACCOUNT_EMAIL, plan, studiedToday: 50 });
    const session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
    const connection = await connectWithToken(server.mcpUrl, session.accessToken);

    try {
      const { data: streakBefore, error: streakError } = await session.supabase
        .from('user_session_streaks')
        .select('current_streak')
        .single();
      expect(streakError).toBeNull();

      const due = await connection.callTool('browse_deck', { selection: 'due' });
      const [card] = jsonOf<SessionCard[]>(due);
      expect(card).toBeDefined();

      const result = await connection.callTool('record_review', {
        cardId: card!.cardId,
        recall: 'remembered',
      });
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toContain('Recorded.');

      const { data: history, error: historyError } = await session.supabase
        .from('review_logs')
        .select('source, quiz_type');
      expect(historyError).toBeNull();
      expect(history).toEqual([{ source: 'mcp', quiz_type: null }]);

      const remaining = await connection.callTool('browse_deck', { selection: 'due' });
      expect(jsonOf<SessionCard[]>(remaining).map((entry) => entry.cardId)).not.toContain(
        card!.cardId,
      );
      const { data: streakAfter, error: finalStreakError } = await session.supabase
        .from('user_session_streaks')
        .select('current_streak')
        .single();
      expect(finalStreakError).toBeNull();
      expect(streakAfter?.current_streak).toBe(streakBefore!.current_streak + 1);
    } finally {
      await connection.close();
    }
  });
}
