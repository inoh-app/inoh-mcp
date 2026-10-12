import { INOH_WEB_APP_URL } from './constants.js';

/**
 * Public word page for a card. Public dictionary entries are open to guests; a
 * private card's page is readable only by its owner, which is who we hand the
 * link to.
 *
 * @param dictionaryId - Id of the dictionary row holding the card
 * @returns Absolute URL of the word page
 */
export const buildWordPageUrl = (dictionaryId: string): string =>
  `${INOH_WEB_APP_URL}/word/${dictionaryId}`;

/** Where a user watches the cards they have asked for, queued ones first. */
export const MY_REQUESTS_URL = `${INOH_WEB_APP_URL}/my-requests`;

/**
 * How to upgrade, for any refusal that offers it.
 *
 * Reason: the iOS app has no plans screen (App Store rule 3.1.1, PRI-21314),
 * so upgrading only works in a browser, signed in to the same account.
 */
export const UPGRADE_DIRECTIONS = `To upgrade, sign in at ${INOH_WEB_APP_URL} in a web browser with this same account and open Settings.`;
