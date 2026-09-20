import { WEB_APP_URL } from './web-app-urls.js';

/**
 * Runtime configuration read from environment variables.
 *
 * Reason: keeping all env access in one place makes it obvious what the
 * server needs to run and avoids scattered `process.env` lookups.
 */
export interface ServerConfig {
  port: number;
  host: string;
  /** Externally reachable base URL of this server, used in OAuth metadata. */
  publicUrl: URL;
  /** Supabase project URL. Its `/auth/v1` path is the OAuth issuer. */
  supabaseUrl: URL;
  /**
   * Supabase publishable (anon) key. Sent as the `apikey` header on data
   * requests; the caller's own bearer token still decides what RLS allows.
   */
  supabasePublishableKey: string;
  /**
   * Legacy shared secret for HS256-signed user JWTs. Optional: projects on
   * asymmetric signing keys are verified through the JWKS instead.
   */
  supabaseJwtSecret: string | undefined;
  /**
   * Browser origins allowed to call `/mcp`. Requests with no `Origin` header
   * (every native MCP client) are always allowed; see origin-validation.ts.
   */
  allowedOrigins: string[];
}

const DEFAULT_PORT = 3333;
const DEFAULT_HOST = '127.0.0.1';

const _readRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
};

const _readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Parses the comma-separated `ALLOWED_ORIGINS` list.
 *
 * Defaults to the Inoh web app alone, so an unrecognised browser client is
 * refused until it is added deliberately rather than allowed by omission. That
 * default follows `WEB_APP_URL`, so a local run allows the local app's origin.
 */
const _parseAllowedOrigins = (rawValue: string | undefined): string[] => {
  if (rawValue === undefined) return [WEB_APP_URL];

  return rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
};

const _parseUrl = (name: string, rawValue: string): URL => {
  try {
    return new URL(rawValue);
  } catch {
    throw new Error(`Invalid ${name} value: "${rawValue}". Expected an absolute URL.`);
  }
};

const _parsePort = (rawPort: string | undefined): number => {
  const port = rawPort === undefined ? DEFAULT_PORT : Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}". Expected a positive integer.`);
  }
  return port;
};

/**
 * Parses server configuration from `process.env`.
 *
 * @returns Validated server configuration with defaults applied
 * @throws {Error} When a required variable is missing or a value is malformed
 */
export const loadServerConfig = (): ServerConfig => {
  const port = _parsePort(process.env.PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;
  const rawPublicUrl = process.env.PUBLIC_URL ?? `http://${host}:${port}`;

  return {
    port,
    host,
    publicUrl: _parseUrl('PUBLIC_URL', rawPublicUrl),
    supabaseUrl: _parseUrl('SUPABASE_URL', _readRequiredEnv('SUPABASE_URL')),
    supabasePublishableKey: _readRequiredEnv('SUPABASE_PUBLISHABLE_KEY'),
    supabaseJwtSecret: _readOptionalEnv('SUPABASE_JWT_SECRET'),
    allowedOrigins: _parseAllowedOrigins(_readOptionalEnv('ALLOWED_ORIGINS')),
  };
};
