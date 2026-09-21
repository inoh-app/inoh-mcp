/**
 * Taking cards out of the deck without a word to search for: a random
 * handful, the newest and oldest, what is due for review, and what the
 * learner keeps forgetting.
 *
 * The seeded deck is small, so nothing here asserts that two random draws
 * differ — that would be a coin toss. What it asserts is that a draw is the
 * right size and comes entirely out of the account's own cards.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalStackReady,
  resetAccount,
  TEST_ACCOUNT_EMAIL,
  type SeededAccount,
} from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import {
  connectWithToken,
  jsonOf,
  signInWithEmailCode,
  textOf,
  type McpConnection,
  type SignedInSession,
} from '../session.js';

interface BrowsedCard {
  cardId: string;
  word: string;
  deckName: string;
}

let server: RunningServer;
let connection: McpConnection;
let session: SignedInSession;
let account: SeededAccount;

/** Resets the account, signs in, and opens a fresh connection as it. */
async function startAs(profile: SeededAccount['profile']): Promise<void> {
  await connection?.close();
  account = resetAccount({ email: TEST_ACCOUNT_EMAIL, profile });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
}

/** The cards one browse handed back. */
async function browse(args: Record<string, unknown>): Promise<BrowsedCard[]> {
  const result = await connection.callTool('browse_deck', args);
  expect(result.isError).not.toBe(true);
  return jsonOf<BrowsedCard[]>(result);
}

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
  await startAs('learner');
});

afterAll(async () => {
  await connection?.close();
  await server?.close();
});

describe('a random handful', () => {
  it('draws as many cards as asked for, all of them the user’s own', async () => {
    const drawn = await browse({ selection: 'random', count: 3 });
    expect(drawn).toHaveLength(3);
    for (const card of drawn) {
      expect(account.words).toContain(card.word);
      expect(card.deckName).toBe(account.deckName);
    }
  });

  it('gives the whole deck rather than inventing cards when asked for more', async () => {
    const drawn = await browse({ selection: 'random', count: 50 });
    expect(drawn).toHaveLength(account.cardCount);
    expect(new Set(drawn.map((card) => card.word))).toEqual(new Set(account.words));
  });

  it('is what you get without naming a selection', async () => {
    const result = await connection.callTool('browse_deck', {});
    expect(textOf(result)).toContain('drawn at random');
  });

  it('refuses a deck that does not exist, listing the ones that do', async () => {
    const result = await connection.callTool('browse_deck', { deckName: 'No Such Deck' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(account.deckName);
  });
});

describe('what is due for review', () => {
  it('returns the scheduled cards and nothing else', async () => {
    const due = await browse({ selection: 'due', count: 20 });
    expect(new Set(due.map((card) => card.word))).toEqual(new Set(account.dueWords));
  });
});

describe('newest and oldest', () => {
  let addedWord: string;

  beforeAll(async () => {
    await startAs('learner');
    addedWord = account.spareWords[0] as string;
    const added = await connection.callTool('add_card_to_deck', { word: addedWord });
    expect(added.isError).not.toBe(true);
  });

  it('puts the card just added at the top of the newest', async () => {
    const newest = await browse({ selection: 'newest', count: 20 });
    expect(newest[0]?.word).toBe(addedWord);
  });

  it('puts that same card at the bottom of the oldest', async () => {
    const oldest = await browse({ selection: 'oldest', count: 20 });
    expect(oldest.at(-1)?.word).toBe(addedWord);
  });
});

describe('the words they keep forgetting', () => {
  beforeAll(async () => {
    await startAs('learner');
  });

  it('says nothing is being forgotten while every card is unmissed', async () => {
    const result = await connection.callTool('browse_deck', { selection: 'struggling' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('has been forgotten in a review yet');
  });

  it('ranks the most forgotten card first, and leaves the unmissed ones out', async () => {
    const [everyDay, sometimes] = await browse({ selection: 'newest', count: 2 });
    // Reason: the review columns are the app's to write, so the fixture the
    // spec needs is written the same way the app would — as the signed-in
    // user, through RLS.
    for (const [card, forgetCount] of [
      [everyDay, 5],
      [sometimes, 2],
    ] as const) {
      const { error } = await session.supabase
        .from('user_cards')
        .update({ forget_count: forgetCount })
        .eq('dictionary_id', card?.cardId ?? '');
      expect(error).toBeNull();
    }

    const struggling = await browse({ selection: 'struggling', count: 20 });
    expect(struggling.map((card) => card.word)).toEqual([everyDay?.word, sometimes?.word]);
  });
});

describe('an empty deck', () => {
  beforeAll(async () => {
    await startAs('empty');
  });

  it('says there is nothing in it yet, and how to put something there', async () => {
    const result = await connection.callTool('browse_deck', { selection: 'random' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('There are no cards in any of their decks yet');
  });
});
