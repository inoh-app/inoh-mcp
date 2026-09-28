/**
 * Cards beyond the plan limit (PRI-21123): when an account holds more cards
 * than its plan allows, the ones beyond the limit are paused. Reviews through
 * an AI client leave them out, say why, refuse to record them, and bring them
 * back once the plan allows them again.
 *
 * Needs the local edge functions served: recording goes through record-review.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalStackReady,
  resetAccount,
  setSubscription,
  TEST_ACCOUNT_EMAIL,
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

/** Free holds 300 cards; the account is seeded five over. */
const FREE_CARD_LIMIT = 300;
const PAUSED_CARD_COUNT = 5;

interface BrowsedCard {
  cardId: string;
  word: string;
  isReviewPaused: boolean;
}

let server: RunningServer;
let connection: McpConnection;
let session: SignedInSession;

/** The account's paused cards, read straight from the backend. */
async function readPausedCards(): Promise<{ dictionaryId: string; word: string }[]> {
  const { data, error } = await session.supabase
    .from('user_cards')
    .select('dictionary_id, dictionary!inner(word)')
    .eq('is_review_paused', true);
  expect(error).toBeNull();
  return ((data ?? []) as unknown as { dictionary_id: string; dictionary: { word: string } }[]).map(
    (row) => ({ dictionaryId: row.dictionary_id, word: row.dictionary.word }),
  );
}

/** One paused card, failing the test when there is none. */
async function readFirstPausedCard(): Promise<{ dictionaryId: string; word: string }> {
  const [pausedCard] = await readPausedCards();
  if (!pausedCard) throw new Error('Expected at least one paused card');
  return pausedCard;
}

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
  resetAccount({
    email: TEST_ACCOUNT_EMAIL,
    plan: 'pro',
    profile: 'card-cap',
    cardCount: FREE_CARD_LIMIT + PAUSED_CARD_COUNT,
  });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
});

afterAll(async () => {
  await connection?.close();
  await server?.close();
});

describe('an account over its plan limit', () => {
  it('pauses nothing while the plan holds every card', async () => {
    expect(await readPausedCards()).toHaveLength(0);
  });

  it('pauses the cards beyond the limit when the plan ends', async () => {
    setSubscription(TEST_ACCOUNT_EMAIL, 'free');
    expect(await readPausedCards()).toHaveLength(PAUSED_CARD_COUNT);
  });

  it('leaves paused cards out of a random draw and says why', async () => {
    const pausedIds = new Set((await readPausedCards()).map((card) => card.dictionaryId));
    const result = await connection.callTool('browse_deck', { selection: 'random', count: 50 });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`${PAUSED_CARD_COUNT} of their cards are paused`);
    const drawn = jsonOf<BrowsedCard[]>(result);
    expect(drawn.some((card) => pausedIds.has(card.cardId))).toBe(false);
  });

  it('marks a paused card when the learner searches for it', async () => {
    const pausedCard = await readFirstPausedCard();
    const result = await connection.callTool('search_deck', { query: pausedCard.word });

    const matches = jsonOf<BrowsedCard[]>(result);
    const match = matches.find((card) => card.cardId === pausedCard.dictionaryId);
    expect(match?.isReviewPaused).toBe(true);
  });

  it('refuses to record a review of a paused card', async () => {
    const pausedCard = await readFirstPausedCard();
    const result = await connection.callTool('record_review', {
      cardId: pausedCard.dictionaryId,
      recall: 'remembered',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('paused');
  });

  it('brings every card back into review after an upgrade', async () => {
    setSubscription(TEST_ACCOUNT_EMAIL, 'pro');
    expect(await readPausedCards()).toHaveLength(0);

    const result = await connection.callTool('browse_deck', { selection: 'random', count: 5 });
    expect(textOf(result)).not.toContain('paused');
  });
});
