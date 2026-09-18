/**
 * Boots the real MCP server in-process, bound to loopback on a free port, and
 * pointed at the local Supabase stack.
 *
 * Reason: `pnpm dev` and `pnpm dev:prod` both listen on 127.0.0.1:3333, so a
 * suite that talked to "whatever is on 3333" could be driving production with
 * a valid token. Building the config here, from constants, means the server
 * under test cannot be pointed anywhere else — and the metadata interlock
 * below proves it before a single tool is called.
 */

import type { AddressInfo } from 'node:net';
import express from 'express';
import type { ServerConfig } from '../src/config.js';
import { MCP_PATH } from '../src/constants.js';
import { registerHttpRoutes } from '../src/http.js';

/** The standard `supabase start` coordinates; see inoh-backend/supabase/e2e/lib/local-stack.ts. */
export const LOCAL_STACK = {
  supabaseUrl: process.env.LOCAL_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  publishableKey:
    process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  jwtSecret:
    process.env.LOCAL_SUPABASE_JWT_SECRET ??
    'super-secret-jwt-token-with-at-least-32-characters-long',
} as const;

const LOOPBACK_HOST = '127.0.0.1';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

export interface RunningServer {
  /** Base URL, e.g. `http://127.0.0.1:52431`. */
  baseUrl: string;
  /** The MCP endpoint itself. */
  mcpUrl: string;
  /** The RFC 9728 document the server advertises. */
  metadataUrl: string;
  close: () => Promise<void>;
}

/**
 * Starts the server and returns once it is listening.
 *
 * @returns Where the server is, and a way to stop it
 * @throws When the running server does not advertise the local Supabase as its
 *   authorization server — the interlock against ever testing production
 */
export const startLocalServer = async (): Promise<RunningServer> => {
  const app = express();
  const listener = await new Promise<import('node:http').Server>((resolve) => {
    const httpServer = app.listen(0, LOOPBACK_HOST, () => resolve(httpServer));
  });
  const { port } = listener.address() as AddressInfo;
  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;

  const config: ServerConfig = {
    port,
    host: LOOPBACK_HOST,
    publicUrl: new URL(baseUrl),
    supabaseUrl: new URL(LOCAL_STACK.supabaseUrl),
    supabasePublishableKey: LOCAL_STACK.publishableKey,
    supabaseJwtSecret: LOCAL_STACK.jwtSecret,
    allowedOrigins: [],
  };
  registerHttpRoutes(app, config);

  const running: RunningServer = {
    baseUrl,
    mcpUrl: `${baseUrl}${MCP_PATH}`,
    metadataUrl: `${baseUrl}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`,
    close: () => new Promise((resolve) => listener.close(() => resolve())),
  };
  await _assertPointsAtLocalStack(running);
  return running;
};

const _assertPointsAtLocalStack = async (running: RunningServer): Promise<void> => {
  const response = await fetch(running.metadataUrl);
  const metadata = (await response.json()) as { authorization_servers?: string[] };
  const expectedIssuer = new URL('/auth/v1', LOCAL_STACK.supabaseUrl).href;
  const [issuer] = metadata.authorization_servers ?? [];
  if (issuer !== expectedIssuer) {
    await running.close();
    throw new Error(
      `Refusing to run: the server under test names ${issuer ?? 'nothing'} as its ` +
        `authorization server, not the local stack (${expectedIssuer}).`,
    );
  }
};
