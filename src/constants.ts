/** Path the MCP endpoint is served on. */
export const MCP_PATH = '/mcp';

/** Unauthenticated liveness endpoint. */
export const HEALTH_PATH = '/health';

/**
 * The Inoh web app. Word pages live at `/word/<dictionaryId>` and are open to
 * guests.
 *
 * Its own host since PRI-20768: inoh.app serves the marketing site and the
 * public dictionary pages, app.inoh.app serves the app. The old host still
 * 308s every app path here, so an older client keeps working.
 *
 * A default rather than a fixed value: `WEB_APP_URL` overrides it, so a server
 * run against local Supabase links to the local app. See web-app-urls.ts.
 */
export const DEFAULT_WEB_APP_URL = 'https://app.inoh.app';

/**
 * Longest word or phrase the tools accept.
 *
 * Reason: mirrors MAX_WORD_LENGTH in the Inoh app and the bound
 * search_dictionary_words applies to its own query, so a caller cannot send
 * something the database would reject anyway.
 */
export const MAX_WORD_LENGTH = 50;

/**
 * Characters a word or phrase may be made of: ASCII letters, digits, spaces,
 * hyphens and apostrophes.
 *
 * Reason: mirrors WORD_CHARACTER_REGEX in the Inoh app, which gates its own
 * request form. Inoh only generates English cards — the definition prompt asks
 * for American English, the phonetic step rejects non-US IPA, and distractors
 * are drawn from English — so a word in another script would spend a slot of
 * the monthly allowance on a card the generator cannot make. Digits and
 * apostrophes are allowed for terms like "30 Under 30", "don't" and "co-op".
 */
export const WORD_CHARACTER_REGEX = /^[a-zA-Z0-9\s'-]+$/;
