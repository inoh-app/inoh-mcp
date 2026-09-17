# MCP server end-to-end tests

Runs the real server in-process against the **local** Supabase stack and
drives every tool with the MCP SDK's own client, signed in with a real
emailed code. Nothing here touches production; `e2e/server.ts` refuses to run
if the server under test names anything but the local stack as its
authorization server.

```bash
cd ../inoh-backend && pnpm db:start   # once
pnpm e2e:run                          # doctor, then the specs
```

The fixtures (account reset, seed profiles, sign-in codes) live in
`inoh-backend/supabase/e2e/`; the whole cross-client picture is in
`inoh-backend/E2E.md`.
