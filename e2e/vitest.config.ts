import { defineConfig } from 'vitest/config';

/**
 * End-to-end config for the MCP server against the local Supabase stack.
 *
 * The specs boot the real server in-process, sign in with a real emailed code,
 * and call the tools over Streamable HTTP with the SDK's own client — no
 * mocking of Supabase, RLS, or the edge functions.
 */
export default defineConfig({
  test: {
    include: ['e2e/specs/**/*.spec.ts'],
    // One at a time: the specs share one local backend and one test account.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
