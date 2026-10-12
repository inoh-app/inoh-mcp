import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { getUserAccessToken } from '../auth/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';

type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type AnyToolCallback = (...handlerArgs: unknown[]) => CallToolResult | Promise<CallToolResult>;

/**
 * Sends one `mcp_tool_called` event to PostHog for the signed-in user.
 *
 * Reason: the database sends it (capture_mcp_tool_called in inoh-backend), so
 * the PostHog token stays in Supabase Vault and the user and AI client come
 * from the caller's own token. A failure is swallowed: analytics must never
 * break a tool.
 *
 * @param connection - Supabase project the event function lives in
 * @param extra - The tool call's request context, which carries the token
 * @param toolName - The tool's registered name
 */
const _sendToolCallEvent = async (
  connection: SupabaseConnection,
  extra: ToolCallExtra,
  toolName: string,
): Promise<void> => {
  try {
    const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));
    await supabase.rpc('capture_mcp_tool_called', { p_tool_name: toolName });
  } catch {
    // Reason: see above; the tool's own result is what the user is waiting for.
  }
};

/**
 * Records every tool call that actually runs as a PostHog event, so the
 * Engagement dashboard shows which tools each AI client uses (PRI-21383).
 *
 * Reason: wrapping registration, like meterToolCalls, means a tool added later
 * is recorded without anyone remembering to. Call it after meterToolCalls, so
 * a call the weekly allowance refuses is not counted as activity.
 *
 * @param server - The server the tools will be registered on
 * @param connection - Supabase project the event function lives in
 */
export const recordToolCalls = (server: McpServer, connection: SupabaseConnection): void => {
  const registerWithoutRecording = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: object, callback: AnyToolCallback) =>
    registerWithoutRecording(name, config, async (...handlerArgs: unknown[]) => {
      // Reason: the SDK passes (args, extra) to a tool with inputs and (extra)
      // to one without, so extra is always last.
      const extra = handlerArgs.at(-1) as ToolCallExtra;
      const [result] = await Promise.all([
        callback(...handlerArgs),
        _sendToolCallEvent(connection, extra, name),
      ]);
      return result;
    })) as McpServer['registerTool'];
};
