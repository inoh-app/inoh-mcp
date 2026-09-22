/**
 * The front door: a client with no token is turned away and told where to get
 * one; a client with a real Supabase session gets in and is told who it is.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalStackReady, resetAccount, TEST_ACCOUNT_EMAIL } from '../backend.js';
import { startLocalServer, type RunningServer } from '../server.js';
import { connectWithToken, signInWithEmailCode, textOf } from '../session.js';

/** The first message every MCP client sends. */
const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'inoh-mcp-e2e', version: '0.0.0' },
  },
};

const MCP_ACCEPT_HEADER = 'application/json, text/event-stream';

let server: RunningServer;

beforeAll(async () => {
  assertLocalStackReady();
  server = await startLocalServer();
});

afterAll(async () => {
  await server?.close();
});

describe('a client without a token', () => {
  it('is refused with a pointer to the resource metadata', async () => {
    const response = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT_HEADER },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('Bearer');
    expect(challenge).toContain(`resource_metadata="${server.metadataUrl}"`);
  });

  it('is refused with a token that was not issued by Supabase', async () => {
    const response = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: MCP_ACCEPT_HEADER,
        Authorization: 'Bearer not-a-real-token',
      },
      body: JSON.stringify(INITIALIZE_REQUEST),
    });
    expect(response.status).toBe(401);
  });

  it('can read the resource metadata at both paths', async () => {
    const expectedIssuer = 'http://127.0.0.1:54321/auth/v1';
    for (const url of [
      server.metadataUrl,
      `${server.baseUrl}/.well-known/oauth-protected-resource`,
    ]) {
      const metadata = (await (await fetch(url)).json()) as {
        resource: string;
        authorization_servers: string[];
        bearer_methods_supported: string[];
      };
      expect(metadata.resource).toBe(server.mcpUrl);
      expect(metadata.authorization_servers).toEqual([expectedIssuer]);
      expect(metadata.bearer_methods_supported).toEqual(['header']);
    }
  });

  it('can check the server is alive without signing in', async () => {
    const response = await fetch(`${server.baseUrl}/health`);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('a client signed in with an emailed code', () => {
  let accessToken: string;

  beforeAll(async () => {
    resetAccount({ email: TEST_ACCOUNT_EMAIL, profile: 'empty' });
    ({ accessToken } = await signInWithEmailCode(TEST_ACCOUNT_EMAIL));
  });

  it('completes the handshake and is told which account it is', async () => {
    const connection = await connectWithToken(server.mcpUrl, accessToken);
    try {
      const result = await connection.callTool('check_account');
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toBe(`Signed in to Inoh as ${TEST_ACCOUNT_EMAIL}.`);
    } finally {
      await connection.close();
    }
  });

  it('sees exactly the tools Inoh publishes', async () => {
    const connection = await connectWithToken(server.mcpUrl, accessToken);
    try {
      const { tools } = await connection.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [
          'add_card_to_deck',
          'browse_deck',
          'check_account',
          'check_card_status',
          'create_private_card',
          'delete_private_card',
          'record_review',
          'remove_card_from_deck',
          'request_public_card',
          'search_deck',
          'search_dictionary',
          'update_private_card',
        ].sort(),
      );
    } finally {
      await connection.close();
    }
  });

  it('is told the endpoint only takes POST', async () => {
    const response = await fetch(server.mcpUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(405);
  });
});
