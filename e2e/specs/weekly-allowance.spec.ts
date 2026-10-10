/**
 * The weekly allowance of tool calls as a user meets it: silence while there
 * is plenty left, a heads-up when the next call might be refused, and a
 * refusal that says when it comes back and what the next plan buys.
 *
 * The spent part of the week is seeded by the fixture rather than made here
 * with dozens of real calls.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL, type Plan } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import { connectWithToken, signInWithEmailCode, textOf, type McpConnection } from '../session.js';

/** Keep in sync with consume_mcp_tool_call. */
const WEEKLY_TOOL_CALLS = { free: 35, plus: 100, pro: 500 } as const;
/** Below this many calls left, every result mentions the allowance. */
const LOW_ALLOWANCE_THRESHOLD = 5;

let server: RunningServer;
let connection: McpConnection | undefined;

/** A fresh account on this plan with this much of the week already spent, signed in. */
async function startWithSpentCalls(plan: Plan, spentMcpCalls: number): Promise<void> {
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'learner', plan, spentMcpCalls });
  const session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
}

/** One ordinary call that needs nothing but the database. */
const browseOneCard = () => connection!.callTool('browse_deck', { selection: 'random', count: 1 });

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
});

describe('the weekly allowance', () => {
  it('says nothing about it while plenty is left', async () => {
    await startWithSpentCalls('free', 0);

    const result = await browseOneCard();
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).not.toContain('Worth mentioning');
  });

  it('warns once the next call might be refused', async () => {
    await startWithSpentCalls('free', WEEKLY_TOOL_CALLS.free - LOW_ALLOWANCE_THRESHOLD - 1);

    const result = await browseOneCard();
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(
      `Worth mentioning: only ${LOW_ALLOWANCE_THRESHOLD} MCP tool calls left this week on the Free plan.`,
    );
  });

  it('refuses once spent, says when it resets and what Plus buys, and leaves the account check free', async () => {
    await startWithSpentCalls('free', WEEKLY_TOOL_CALLS.free);

    const refusal = await browseOneCard();
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain(
      `All ${WEEKLY_TOOL_CALLS.free} MCP tool calls in this week's Free plan allowance are used up.`,
    );
    expect(textOf(refusal)).toContain('A tool call is one thing an AI assistant does in Inoh');
    expect(textOf(refusal)).toContain('They reset on Monday.');
    expect(textOf(refusal)).toContain('You can keep reviewing in the Inoh app in the meantime.');
    expect(textOf(refusal)).toContain('Inoh Plus covers 10 review sessions with Claude a week');
    expect(textOf(refusal)).toContain('/subscription-plan');

    const accountCheck = await connection!.callTool('check_account', {});
    expect(accountCheck.isError).not.toBe(true);
    expect(textOf(accountCheck)).toContain(`Signed in to Inoh as ${TEST_ACCOUNT_EMAIL}`);
  });

  it("deals today's session without spending a call, so a session costs only its answers", async () => {
    await startWithSpentCalls('free', WEEKLY_TOOL_CALLS.free);

    const session = await connection!.callTool('browse_deck', { selection: 'due' });
    expect(session.isError).not.toBe(true);
    expect(textOf(session)).not.toContain('used up');
  });

  it('allows the 100th Plus call and refuses the next one', async () => {
    await startWithSpentCalls('plus', WEEKLY_TOOL_CALLS.plus - 1);

    const lastAllowedCall = await browseOneCard();
    expect(lastAllowedCall.isError).not.toBe(true);
    expect(textOf(lastAllowedCall)).toContain('only 0 MCP tool calls left this week');

    const refusal = await browseOneCard();
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain(
      `All ${WEEKLY_TOOL_CALLS.plus} MCP tool calls in this week's Plus plan allowance are used up.`,
    );
  });

  it('refuses Plus usage already above the lowered allowance', async () => {
    await startWithSpentCalls('plus', 120);

    const refusal = await browseOneCard();
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain('Inoh Pro covers 50 review sessions with Claude a week');
  });

  it('points a spent Plus account at Pro', async () => {
    await startWithSpentCalls('plus', WEEKLY_TOOL_CALLS.plus);

    const refusal = await browseOneCard();
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain('Inoh Pro covers 50 review sessions with Claude a week');
  });

  it('lets Pro keep going past the Plus allowance, and offers no upgrade when spent', async () => {
    await startWithSpentCalls('pro', WEEKLY_TOOL_CALLS.plus);
    expect((await browseOneCard()).isError).not.toBe(true);

    await connection?.close();
    await startWithSpentCalls('pro', WEEKLY_TOOL_CALLS.pro);
    const refusal = await browseOneCard();
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain(
      `All ${WEEKLY_TOOL_CALLS.pro} MCP tool calls in this week's Pro plan allowance are used up.`,
    );
    expect(textOf(refusal)).not.toContain('Upgrade');
  });
});
