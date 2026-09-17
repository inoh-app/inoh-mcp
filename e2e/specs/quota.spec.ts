/**
 * The monthly private-card allowance as a user meets it: silence while there is
 * plenty left, a heads-up when the next card might be refused, and a refusal
 * that says where to upgrade once it is gone. Free plan, the tightest one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import {
  connectWithToken,
  signInWithEmailCode,
  textOf,
  type McpConnection,
  type SignedInSession,
} from '../session.js';

/** Below this many cards left, the tools start mentioning the allowance. */
const LOW_ALLOWANCE_THRESHOLD = 5;

let server: RunningServer;
let connection: McpConnection;
let session: SignedInSession;

async function readQuota(): Promise<{
  plan: string;
  used: number;
  monthly_limit: number;
  remaining: number;
}> {
  const { data, error } = await session.supabase.rpc('private_card_quota').maybeSingle();
  if (error || !data) throw new Error(`private_card_quota failed: ${error?.message}`);
  return data as { plan: string; used: number; monthly_limit: number; remaining: number };
}

/**
 * Uses up allowance the way the app does — one request row per card — without
 * going through the tool under test, so the tool's own message is what is
 * asserted, not a side effect of how the allowance was spent.
 */
async function spendAllowance(count: number): Promise<void> {
  if (count <= 0) return;
  const rows = Array.from({ length: count }, (_, index) => ({
    user_id: session.userId,
    word: `quota filler ${Date.now().toString(36)} ${index}`,
    context: 'filler',
    destination: 'private',
    source: 'mcp',
  }));
  const { error } = await session.supabase.from('card_requests').insert(rows);
  if (error) throw new Error(`Could not spend allowance: ${error.message}`);
}

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'empty', plan: 'free' });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
});

afterAll(async () => {
  await connection?.close();
  await server?.close();
});

describe('the free plan allowance', () => {
  it('starts at 50 a month', async () => {
    expect(await readQuota()).toMatchObject({ plan: 'free', monthly_limit: 50 });
  });

  it('says nothing about the tally while plenty is left', async () => {
    const result = await connection.callTool('create_private_card', { word: 'quota quiet one' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).not.toContain('Worth mentioning');
  });

  it('warns once the next card might be refused', async () => {
    const { remaining } = await readQuota();
    await spendAllowance(remaining - LOW_ALLOWANCE_THRESHOLD - 1);

    const result = await connection.callTool('create_private_card', { word: 'quota near end' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(
      `Worth mentioning: only ${LOW_ALLOWANCE_THRESHOLD} private cards left this month on the free plan.`,
    );
  });

  it('refuses the card after the last one, and says where to upgrade', async () => {
    await spendAllowance((await readQuota()).remaining);
    expect((await readQuota()).remaining).toBe(0);

    const result = await connection.callTool('create_private_card', { word: 'quota over the top' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'your Free plan makes 50 private cards a month and you have used them all',
    );
    expect(textOf(result)).toContain('Upgrade at ');
    expect(textOf(result)).toContain('/subscription-plan');
  });

  it('is not spent by suggesting a public word', async () => {
    const result = await connection.callTool('request_public_card', { word: 'quota public word' });
    expect(result.isError).not.toBe(true);
    expect((await readQuota()).remaining).toBe(0);
  });
});
