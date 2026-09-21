import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseConnection } from '../supabase/index.js';
import { registerAddCardToDeckTool } from './add-card-to-deck.js';
import { registerBrowseDeckTool } from './browse-deck.js';
import { registerCheckAccountTool } from './check-account.js';
import { registerCheckCardStatusTool } from './check-card-status.js';
import { registerCreatePrivateCardTool } from './create-private-card.js';
import { registerDeletePrivateCardTool } from './delete-private-card.js';
import { registerRemoveCardFromDeckTool } from './remove-card-from-deck.js';
import { registerRequestPublicCardTool } from './request-public-card.js';
import { registerSearchDeckTool } from './search-deck.js';
import { registerSearchDictionaryTool } from './search-dictionary.js';
import { registerUpdatePrivateCardTool } from './update-private-card.js';

/**
 * Registers every tool the Inoh MCP server exposes.
 *
 * Reason: this is the allowlist. A tool that is not registered here is not
 * reachable by any AI client, which is the core of the security model.
 *
 * @param server - The MCP server to register tools on
 * @param connection - Supabase project the data tools talk to
 */
export const registerAllTools = (server: McpServer, connection: SupabaseConnection): void => {
  registerCheckAccountTool(server);
  registerSearchDictionaryTool(server, connection);
  registerSearchDeckTool(server, connection);
  registerBrowseDeckTool(server, connection);
  registerAddCardToDeckTool(server, connection);
  registerRemoveCardFromDeckTool(server, connection);
  registerCreatePrivateCardTool(server, connection);
  registerUpdatePrivateCardTool(server, connection);
  registerRequestPublicCardTool(server, connection);
  registerCheckCardStatusTool(server, connection);
  registerDeletePrivateCardTool(server, connection);
};
