/**
 * The monthly private-card allowance as a user meets it: silence while there is
 * plenty left, a heads-up when the next card might be refused, and a refusal
 * that says where to upgrade once it is gone. Free plan, the tightest one.
 *
 * The spent part of the month is seeded by the fixture, never written here as
 * pending requests: a pending row is a real job to the card generator.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import {
  connectWithToken,
  signInWithEmailCode,
  textOf,
  type McpConnection,
  type SignedInSession,
} from '../session.js';

/** Keep in sync with enforce_monthly_private_card_limit. */
const FREE_MONTHLY_PRIVATE_CARDS = 50;
/** Below this many cards left, the tools start mentioning the allowance. */
const LOW_ALLOWANCE_THRESHOLD = 5;

let server: RunningServer;
let connection: McpConnection | undefined;
let session: SignedInSession;

/** A fresh free account with this much of the month already spent, signed in. */
async function startWithSpentCards(spentPrivateCards: number): Promise<void> {
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'empty', plan: 'free', spentPrivateCards });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
}

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

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
});

afterEach(async () => {
  await connection?.close();
  connection = undefined;
});

afterAll(async () => {
  await server?.close();
  // Reason: the specs asked for real cards, which sit as pending requests — a
  // job for any card generator that happens to be running. Leave none behind.
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'empty' });
});

describe('the free plan allowance', () => {
  it('starts at 50 a month, and says nothing about the tally while plenty is left', async () => {
    await startWithSpentCards(0);
    expect(await readQuota()).toMatchObject({
      plan: 'free',
      monthly_limit: FREE_MONTHLY_PRIVATE_CARDS,
    });

    const result = await connection!.callTool('create_private_card', { word: 'quota quiet one' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).not.toContain('Worth mentioning');
  });

  it('warns once the next card might be refused', async () => {
    await startWithSpentCards(FREE_MONTHLY_PRIVATE_CARDS - LOW_ALLOWANCE_THRESHOLD - 1);

    const result = await connection!.callTool('create_private_card', { word: 'quota near end' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(
      `Worth mentioning: only ${LOW_ALLOWANCE_THRESHOLD} private cards left this month on the free plan.`,
    );
  });

  it('refuses the card after the last one, says where to upgrade, and still takes a public suggestion', async () => {
    await startWithSpentCards(FREE_MONTHLY_PRIVATE_CARDS);
    expect((await readQuota()).remaining).toBe(0);

    const refusal = await connection!.callTool('create_private_card', {
      word: 'quota over the top',
    });
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain(
      'your Free plan makes 50 private cards a month and you have used them all',
    );
    expect(textOf(refusal)).toContain('Upgrade at ');
    expect(textOf(refusal)).toContain('/subscription-plan');

    const suggestion = await connection!.callTool('request_public_card', {
      word: 'quota public word',
    });
    expect(suggestion.isError).not.toBe(true);
    expect((await readQuota()).remaining).toBe(0);
  });
});
