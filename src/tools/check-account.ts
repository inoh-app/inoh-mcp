import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAuthenticatedUser } from '../auth/index.js';

const MISSING_EMAIL_MESSAGE = 'Signed in to Inoh, but this account has no email address on record.';

const TOOL_TITLE = 'Check account';

/**
 * Registers a `check_account` tool that reports which Inoh account the
 * connection is signed in as.
 *
 * Reason: the response deliberately carries only the email. The internal user
 * id means nothing to the person asking, so leaving it out keeps it from being
 * echoed back at them.
 *
 * @param server - The MCP server to register the tool on
 */
export const registerCheckAccountTool = (server: McpServer): void => {
  server.registerTool(
    'check_account',
    {
      title: TOOL_TITLE,
      annotations: { title: TOOL_TITLE, readOnlyHint: true, openWorldHint: false },
      description:
        'Returns the email of the Inoh account this connection is signed in as. ' +
        'Use it to confirm sign-in worked, and to check the connection is healthy.',
    },
    async (extra) => {
      const { email } = getAuthenticatedUser(extra.authInfo);
      const text = email === undefined ? MISSING_EMAIL_MESSAGE : `Signed in to Inoh as ${email}.`;
      return { content: [{ type: 'text', text }] };
    },
  );
};
