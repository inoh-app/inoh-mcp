import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { getUserAccessToken } from '../auth/index.js';
import { createUserSupabaseClient, type SupabaseConnection } from '../supabase/index.js';
import { buildToolError } from '../tools/tool-result.js';
import {
  consumeWeeklyToolCall,
  describeLowWeeklyAllowance,
  describeSpentAllowance,
} from './weekly-allowance.js';

type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type AnyToolCallback = (...handlerArgs: unknown[]) => CallToolResult | Promise<CallToolResult>;

/**
 * Tools that never count against the allowance.
 *
 * Reason: the sign-in check is how a user finds out which account they are on
 * and whether the connection works, which they need most once they are out.
 */
const UNMETERED_TOOL_NAMES = new Set(['check_account']);

/**
 * Makes every tool registered on this server count against the user's weekly
 * allowance before it runs.
 *
 * Reason: wrapping registration, rather than each tool calling the counter
 * itself, means a tool added later is counted without anyone remembering to.
 * Call it before any tool is registered.
 *
 * @param server - The server the tools will be registered on
 * @param connection - Supabase project the counter lives in
 */
export const meterToolCalls = (server: McpServer, connection: SupabaseConnection): void => {
  const registerUnmeteredTool = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: object, callback: AnyToolCallback) =>
    registerUnmeteredTool(
      name,
      config,
      UNMETERED_TOOL_NAMES.has(name) ? callback : _meter(callback, connection),
    )) as McpServer['registerTool'];
};

/**
 * Wraps one tool's handler so it runs only while the allowance lasts.
 *
 * @param callback - The tool's own handler
 * @param connection - Supabase project the counter lives in
 * @returns A handler that counts, refuses once spent, and warns when nearly so
 */
const _meter =
  (callback: AnyToolCallback, connection: SupabaseConnection): AnyToolCallback =>
  async (...handlerArgs) => {
    // Reason: the SDK passes (args, extra) to a tool with inputs and (extra)
    // to one without, so extra is always last.
    const extra = handlerArgs.at(-1) as ToolCallExtra;
    const supabase = createUserSupabaseClient(connection, getUserAccessToken(extra.authInfo));
    const allowance = await consumeWeeklyToolCall(supabase);

    if (!allowance.isAllowed) {
      return buildToolError(describeSpentAllowance(allowance));
    }

    const result = await callback(...handlerArgs);
    const lowAllowanceNote = describeLowWeeklyAllowance(allowance);
    return lowAllowanceNote === null
      ? result
      : { ...result, content: [...result.content, { type: 'text', text: lowAllowanceNote }] };
  };
