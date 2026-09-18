/**
 * A signed-in MCP client, obtained the way a user's own client would obtain
 * it: a real Supabase session for the test account, presented as the bearer.
 *
 * Reason: a minted token (`pnpm token:local`) would do for most tools, but the
 * `delete-private-card` edge function checks the token's session against
 * `auth.sessions`, which a minted token never has. A real sign-in covers every
 * tool, and is closer to what happens in production.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readSignInCode } from './backend.js';
import { LOCAL_STACK } from './server.js';

export interface SignedInSession {
  accessToken: string;
  userId: string;
  /** Talks to the local stack as the signed-in user, for reads the tools do not expose. */
  supabase: SupabaseClient;
}

/**
 * Signs in with a real emailed code, exactly as a user would: ask for a code,
 * read it out of the local mail catcher, hand it back.
 *
 * @param email - The seeded test account's address
 * @returns The session's access token and a client acting as that user
 */
export const signInWithEmailCode = async (email: string): Promise<SignedInSession> => {
  const supabase = createClient(LOCAL_STACK.supabaseUrl, LOCAL_STACK.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Stamp the clock before asking, so a code from an earlier test in the same
  // run can never be mistaken for this one — codes stay valid for an hour.
  const requestedAtMs = Date.now();
  const { error: requestError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (requestError) throw new Error(`Could not request a sign-in code: ${requestError.message}`);

  const code = readSignInCode(email, requestedAtMs);
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error || !data.session || !data.user) {
    throw new Error(`Could not verify the sign-in code: ${error?.message ?? 'no session'}`);
  }

  return { accessToken: data.session.access_token, userId: data.user.id, supabase };
};

export interface McpConnection {
  client: Client;
  /**
   * Calls one tool and returns its result.
   *
   * @param name - Tool name, e.g. `search_dictionary`
   * @param args - The tool's input
   */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  /** The concatenated text of one tool result. */
  close: () => Promise<void>;
}

/**
 * Connects the SDK's own client to the server with the given bearer token.
 *
 * @param mcpUrl - The server's `/mcp` endpoint
 * @param accessToken - Bearer to present; pass a bad one to test refusal
 * @returns A connected client
 */
export const connectWithToken = async (
  mcpUrl: string,
  accessToken: string,
): Promise<McpConnection> => {
  const client = new Client({ name: 'inoh-mcp-e2e', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return {
    client,
    callTool: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    close: () => client.close(),
  };
};

/**
 * The text a tool result carries, joined — every Inoh tool answers in text.
 *
 * @param result - A tool result
 * @returns Its text content
 */
export const textOf = (result: CallToolResult): string =>
  result.content.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n');

/**
 * The JSON payload a tool embeds after its summary line.
 *
 * @param result - A tool result whose text ends in, or contains, one JSON value
 * @returns The parsed value
 */
export const jsonOf = <T>(result: CallToolResult): T => {
  const text = textOf(result);
  const start = Math.min(
    ...['[', '{'].map((opener) => text.indexOf(opener)).filter((index) => index >= 0),
  );
  const closer = text[start] === '[' ? ']' : '}';
  const end = text.lastIndexOf(closer);
  return JSON.parse(text.slice(start, end + 1)) as T;
};
