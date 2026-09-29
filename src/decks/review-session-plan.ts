/**
 * Size rules for one review session. Mirrors src/constants/review-session.ts
 * and src/lib/review-session-plan.ts in the app, so a session in an AI client
 * and one in the app are the same.
 */

/** Most words one session serves. */
export const SESSION_CARDS_LIMIT = 10;

/** Spots in a session kept for new words when there are any. */
export const SESSION_MIN_NEW_CARDS = 3;

/**
 * Above this many scheduled words due today, a session is all catch-up: no new
 * words until the pile is back down to this size.
 */
export const SESSION_DUE_BACKLOG_LIMIT = 20;

/** How many scheduled and new words one session takes. */
export interface ReviewSessionPlan {
  scheduledCardCount: number;
  newCardCount: number;
}

/**
 * Splits one review session between scheduled and new words.
 *
 * New words get at least SESSION_MIN_NEW_CARDS spots when there are any, and
 * scheduled words fill the rest; a side with too few words leaves its spots to
 * the other, and the session is shorter when both run out. When more than
 * SESSION_DUE_BACKLOG_LIMIT scheduled words are due, the session takes only
 * scheduled words.
 *
 * @param scheduledDueCardCount - Words already studied and due by the end of today
 * @param newCardCount - Words never reviewed yet
 * @returns How many of each the session takes
 */
export const planReviewSession = (
  scheduledDueCardCount: number,
  newCardCount: number,
): ReviewSessionPlan => {
  // Reason: every new word adds future reviews, so a learner who is behind
  // catches up first; otherwise the pile refills faster than it is cleared.
  const isCatchingUp = scheduledDueCardCount > SESSION_DUE_BACKLOG_LIMIT;
  if (isCatchingUp) {
    return { scheduledCardCount: SESSION_CARDS_LIMIT, newCardCount: 0 };
  }

  const spotsLeftByScheduledCards = SESSION_CARDS_LIMIT - scheduledDueCardCount;
  const newSpots = Math.max(SESSION_MIN_NEW_CARDS, spotsLeftByScheduledCards);
  const plannedNewCardCount = Math.min(newCardCount, newSpots);
  const plannedScheduledCardCount = Math.min(
    scheduledDueCardCount,
    SESSION_CARDS_LIMIT - plannedNewCardCount,
  );

  return { scheduledCardCount: plannedScheduledCardCount, newCardCount: plannedNewCardCount };
};
