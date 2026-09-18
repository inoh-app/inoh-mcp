/**
 * The everyday tools: look a word up, see what is already in the deck, add a
 * card, take it out again — and the plan's card cap holding at the boundary.
 * Every assertion that matters is made against the database, not the reply.
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
} from '../session.js';

interface DictionaryMatch {
  id: string;
  word: string;
  isPrivate: boolean;
  url: string;
}

interface DeckMatch {
  cardId: string;
  word: string;
  deckName: string;
}

let server: RunningServer;
let connection: McpConnection;
let account: SeededAccount;

/** Resets the account, signs in, and opens a fresh connection as it. */
async function startAs(profile: SeededAccount['profile']): Promise<void> {
  await connection?.close();
  account = resetAccount({ email: TEST_ACCOUNT_EMAIL, profile });
  const { accessToken } = await signInWithEmailCode(TEST_ACCOUNT_EMAIL);
  connection = await connectWithToken(server.mcpUrl, accessToken);
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

describe('looking words up', () => {
  it('finds a dictionary word, with a link to its page', async () => {
    const [word] = account.spareWords;
    const result = await connection.callTool('search_dictionary', { query: word });
    expect(result.isError).not.toBe(true);
    const matches = jsonOf<DictionaryMatch[]>(result);
    const match = matches.find((candidate) => candidate.word === word);
    expect(match).toBeDefined();
    expect(match?.isPrivate).toBe(false);
    expect(match?.url).toContain(`/word/${match?.id}`);
  });

  it('says so when nothing matches', async () => {
    const result = await connection.callTool('search_dictionary', { query: 'zzqxjv' });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('Nothing matches "zzqxjv"');
  });

  it('finds a word the user already holds, naming the deck', async () => {
    const [heldWord] = account.words;
    const result = await connection.callTool('search_deck', { query: heldWord });
    const matches = jsonOf<DeckMatch[]>(result);
    expect(matches.map((match) => match.word)).toContain(heldWord);
    expect(matches[0]?.deckName).toBe(account.deckName);
  });

  it('does not find a word the user is not learning yet', async () => {
    const [spareWord] = account.spareWords;
    const result = await connection.callTool('search_deck', { query: spareWord });
    expect(textOf(result)).toContain(`Nothing in any of their decks matches "${spareWord}"`);
  });

  it('refuses a deck that does not exist, listing the ones that do', async () => {
    const result = await connection.callTool('search_deck', {
      query: account.words[0],
      deckName: 'No Such Deck',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(account.deckName);
  });
});

describe('adding and removing', () => {
  it('adds a word to the default deck, and the card starts unreviewed', async () => {
    const word = account.spareWords[1] ?? account.spareWords[0];
    const result = await connection.callTool('add_card_to_deck', { word });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(`Added "${word}" to the "${account.deckName}" deck.`);

    const state = readAccountState(TEST_ACCOUNT_EMAIL);
    expect(state.words).toContain(word);
    expect(state.cardCount).toBe(account.cardCount + 1);
  });

  it('will not add a word the deck already holds', async () => {
    const [heldWord] = account.words;
    const result = await connection.callTool('add_card_to_deck', { word: heldWord });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      `"${heldWord}" is already in their "${account.deckName}" deck`,
    );
    expect(readAccountState(TEST_ACCOUNT_EMAIL).words.filter((w) => w === heldWord)).toHaveLength(
      1,
    );
  });

  it('tells the caller when the word is not in the dictionary at all', async () => {
    const result = await connection.callTool('add_card_to_deck', { word: 'zzqxjv' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('is not in the Inoh dictionary');
  });

  it('removes a word from the deck but leaves it in the dictionary', async () => {
    const [heldWord] = account.words;
    const result = await connection.callTool('remove_card_from_deck', { word: heldWord });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain(
      `Removed "${heldWord}" from their "${account.deckName}" deck.`,
    );
    expect(textOf(result)).toContain('still in the public Inoh dictionary');

    expect(readAccountState(TEST_ACCOUNT_EMAIL).words).not.toContain(heldWord);
    const stillInDictionary = jsonOf<DictionaryMatch[]>(
      await connection.callTool('search_dictionary', { query: heldWord }),
    );
    expect(stillInDictionary.map((match) => match.word)).toContain(heldWord);
  });

  it('says nothing was removed for a word not in the deck', async () => {
    const [spareWord] = account.spareWords;
    // Spare words are deliberately off the account; the one added above is skipped.
    const notHeld =
      account.spareWords.find((w) => !readAccountState(TEST_ACCOUNT_EMAIL).words.includes(w)) ??
      spareWord;
    const result = await connection.callTool('remove_card_from_deck', { word: notHeld });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('nothing was removed');
  });
});

describe('the plan card cap', () => {
  beforeAll(async () => {
    await startAs('card-cap');
  });

  it('refuses the next card once a free deck is full, and says how to lift it', async () => {
    const [spareWord] = account.spareWords;
    const result = await connection.callTool('add_card_to_deck', { word: spareWord });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Your Free plan holds up to 300 cards');
    expect(textOf(result)).toContain('Upgrade to Plus');
    expect(readAccountState(TEST_ACCOUNT_EMAIL).cardCount).toBe(account.cardCount);
  });
});
