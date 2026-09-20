import { DEFAULT_WEB_APP_URL } from './constants.js';

/**
 * Base URL every link this server hands an AI client is built from.
 *
 * Reason: the one `process.env` lookup outside config.ts. Links are built deep
 * inside the tool modules and the card-request helpers, none of which take a
 * config, and threading a base URL through all of them to change one string in
 * local development costs more than it buys. Left unset in production, where
 * the default is already right; set to `http://localhost:8080` in .env.local so
 * a locally created card links to the local app rather than to real data.
 */
export const WEB_APP_URL = (process.env.WEB_APP_URL ?? DEFAULT_WEB_APP_URL).replace(/\/+$/, '');

/**
 * Public word page for a card. Public dictionary entries are open to guests; a
 * private card's page is readable only by its owner, which is who we hand the
 * link to.
 *
 * @param dictionaryId - Id of the dictionary row holding the card
 * @returns Absolute URL of the word page
 */
export const buildWordPageUrl = (dictionaryId: string): string =>
  `${WEB_APP_URL}/word/${dictionaryId}`;

/** Where a user watches the cards they have asked for, queued ones first. */
export const MY_REQUESTS_URL = `${WEB_APP_URL}/my-requests`;

/** Where a user lifts the month's private card allowance. */
export const PLANS_URL = `${WEB_APP_URL}/subscription-plan`;
