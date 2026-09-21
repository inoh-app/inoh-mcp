/**
 * The private dictionary through the MCP server: asking for a card, checking
 * on it, remaking one, suggesting a public word, and deleting a card for good.
 *
 * No card generator runs in an e2e stack, so a request stays "generating"; the
 * assertions are about the request the server wrote and the card it deleted,
 * both read straight from the database.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalStackReady,
  readAccountState,
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

interface RequestReceipt {
  requestId: string;
  word: string;
  status: string;
  cardId?: string;
}

interface RequestStatus {
  requestId: string;
  word: string;
  destination: 'private' | 'public';
  progress: string;
  redoOfCardId?: string;
}

interface DictionaryMatch {
  id: string;
  word: string;
  isPrivate: boolean;
}

/**
 * A word the seeded public dictionary carries, and two senses of it.
 *
 * The two meanings of "battery" are nothing like each other, so one word
 * exercises the duplicate check in both directions: the sense the dictionary
 * holds has to be caught, and the other one has to go straight through.
 */
const SEEDED_WORD = 'battery';
const SEEDED_WORD_MATCHING_DEFINITION = 'Device that stores and provides electrical energy';
const SEEDED_WORD_UNRELATED_DEFINITION = 'the crime of unlawfully hitting another person';

/** A word no dictionary has, so a request for it is never a duplicate. */
const freshWord = (): string => `mcp e2e ${Date.now().toString(36)}`;

let server: RunningServer;
let connection: McpConnection;
let session: SignedInSession;
let account: SeededAccount;

/** Reads the caller's own private-card allowance, as the app does. */
async function readQuota(): Promise<{ used: number; monthly_limit: number; remaining: number }> {
  const { data, error } = await session.supabase.rpc('private_card_quota').maybeSingle();
  if (error || !data) throw new Error(`private_card_quota failed: ${error?.message}`);
  return data as { used: number; monthly_limit: number; remaining: number };
}

/** The dictionary id of one of the account's own cards. */
async function findOwnCardId(word: string): Promise<string> {
  const matches = jsonOf<DictionaryMatch[]>(
    await connection.callTool('search_dictionary', { query: word }),
  );
  const own = matches.find((match) => match.word === word && match.isPrivate);
  expect(own, `expected "${word}" to be one of the account's own cards`).toBeDefined();
  return own!.id;
}

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
  account = resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'learner', privateCards: 2 });
  session = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, session.accessToken);
});

afterAll(async () => {
  await connection?.close();
  await server?.close();
  // Reason: the specs asked for real cards, which sit as pending requests — a
  // job for any card generator that happens to be running. Leave none behind.
  resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'empty' });
});

describe('asking for a private card', () => {
  it('queues a request for a word no dictionary has, spending one card of the allowance', async () => {
    const word = freshWord();
    const before = await readQuota();

    const result = await connection.callTool('create_private_card', { word });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Making a card for "${word}"`);
    const receipt = jsonOf<RequestReceipt>(result);
    expect(receipt.status).toBe('generating');

    expect(readAccountState(TEST_ACCOUNT_EMAIL).cardRequests).toContainEqual(
      expect.objectContaining({ word }),
    );
    expect((await readQuota()).used).toBe(before.used + 1);

    const status = jsonOf<RequestStatus[]>(
      await connection.callTool('check_card_status', { requestId: receipt.requestId }),
    );
    expect(status[0]).toMatchObject({ requestId: receipt.requestId, word, destination: 'private' });
    expect(status[0]?.progress).toBe('generating');
  });

  it('points at the public card instead when the word already exists', async () => {
    const [publicWord] = account.spareWords;
    const before = await readQuota();
    const result = await connection.callTool('create_private_card', { word: publicWord });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      `The public Inoh dictionary already has a card for "${publicWord}"`,
    );
    expect((await readQuota()).used).toBe(before.used);
  });

  it('makes one anyway when the caller insists on a different sense', async () => {
    const [publicWord] = account.spareWords;
    const result = await connection.callTool('create_private_card', {
      word: publicWord,
      context: 'the less common sense, for a test',
      createAnyway: true,
    });
    expect(result.isError).not.toBe(true);
    expect(jsonOf<RequestReceipt>(result).word).toBe(publicWord);
  });

  it('catches the sense the dictionary already teaches', async () => {
    const before = await readQuota();
    const result = await connection.callTool('create_private_card', {
      word: SEEDED_WORD,
      context: SEEDED_WORD_MATCHING_DEFINITION,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`already has a card for "${SEEDED_WORD}"`);
    expect((await readQuota()).used).toBe(before.used);
  });

  it('lets a genuinely different sense of the same word through', async () => {
    // No createAnyway. The check compares what the card teaches rather than
    // how the word is spelled, so a sense the dictionary does not cover is
    // not a duplicate and should never have to be insisted on. Matching on
    // the word alone, which is what this used to do, refused it.
    const result = await connection.callTool('create_private_card', {
      word: SEEDED_WORD,
      context: SEEDED_WORD_UNRELATED_DEFINITION,
    });

    expect(result.isError).not.toBe(true);
    expect(jsonOf<RequestReceipt>(result).word).toBe(SEEDED_WORD);
  });

  it('refuses a word Inoh cannot make a card for', async () => {
    const before = await readQuota();
    for (const word of ['日本語', 'a'.repeat(51)]) {
      const result = await connection.callTool('create_private_card', { word });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Input validation error');
    }
    expect((await readQuota()).used).toBe(before.used);
  });
});

describe('remaking a card the user made', () => {
  it('queues a redo against the existing card, keeping its id', async () => {
    const ownWord = account.privateWords[0] ?? '';
    const cardId = await findOwnCardId(ownWord);

    const result = await connection.callTool('update_private_card', {
      word: ownWord,
      context: 'a sharper example sentence',
    });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Remaking the card for "${ownWord}"`);
    const receipt = jsonOf<RequestReceipt>(result);
    expect(receipt.cardId).toBe(cardId);

    const [status] = jsonOf<RequestStatus[]>(
      await connection.callTool('check_card_status', { requestId: receipt.requestId }),
    );
    expect(status?.redoOfCardId).toBe(cardId);
  });

  it('will not remake a public dictionary card', async () => {
    const [publicWord] = account.words;
    const result = await connection.callTool('update_private_card', {
      word: publicWord,
      context: 'anything',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`The user has no private card for "${publicWord}"`);
  });
});

describe('suggesting a public word', () => {
  it('records the suggestion without touching the private allowance', async () => {
    const word = freshWord();
    const before = await readQuota();

    const result = await connection.callTool('request_public_card', { word });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Suggested "${word}" for the public Inoh dictionary`);

    expect((await readQuota()).used).toBe(before.used);
    const [status] = jsonOf<RequestStatus[]>(
      await connection.callTool('check_card_status', {
        requestId: jsonOf<RequestReceipt>(result).requestId,
      }),
    );
    expect(status).toMatchObject({ word, destination: 'public' });
  });

  it('catches the sense the dictionary already teaches', async () => {
    const result = await connection.callTool('request_public_card', {
      word: SEEDED_WORD,
      context: SEEDED_WORD_MATCHING_DEFINITION,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`already has a card for "${SEEDED_WORD}"`);
  });

  it('lets a genuinely different sense of the same word through', async () => {
    // The whole point of suggesting a word Inoh already carries: the shared
    // dictionary is missing every sense of it but the one.
    const result = await connection.callTool('request_public_card', {
      word: SEEDED_WORD,
      context: SEEDED_WORD_UNRELATED_DEFINITION,
    });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Suggested "${SEEDED_WORD}"`);
  });
});

describe('deleting a card the user made', () => {
  it('destroys the card: gone from the private dictionary and from the deck', async () => {
    const ownWord = account.privateWords[1] ?? account.privateWords[0];
    expect(readAccountState(TEST_ACCOUNT_EMAIL).privateWords).toContain(ownWord);

    const result = await connection.callTool('delete_private_card', { word: ownWord });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Deleted the card for "${ownWord}"`);

    const state = readAccountState(TEST_ACCOUNT_EMAIL);
    expect(state.privateWords).not.toContain(ownWord);
    expect(state.words).not.toContain(ownWord);
  });

  it('refuses to delete a public dictionary card, offering removal instead', async () => {
    const publicWord = account.words[1] ?? account.words[0];
    const result = await connection.callTool('delete_private_card', { word: publicWord });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/cannot be deleted|no card of their own/);
    expect(readAccountState(TEST_ACCOUNT_EMAIL).words).toContain(publicWord);
  });
});
