import type { SupabaseClient } from '@supabase/supabase-js';

export interface PrivateCardQuota {
  /** The plan the allowance came from: free, plus or pro. */
  plan: string;
  used: number;
  limit: number;
  remaining: number;
}

/** Shape `private_card_quota` returns. */
interface PrivateCardQuotaRow {
  plan: string;
  used: number;
  monthly_limit: number;
  remaining: number;
}

/** What to say when the allowance cannot be read at all. */
const UNKNOWN_QUOTA: PrivateCardQuota = { plan: 'free', used: 0, limit: 50, remaining: 50 };

/**
 * How few cards left before the allowance is worth raising unprompted.
 *
 * Reason: at 3 of 300 the tally is noise — it carries no information and no
 * decision hangs on it. Near the end it is a genuine heads-up, because the next
 * card may be refused.
 */
const LOW_ALLOWANCE_THRESHOLD = 5;

/**
 * A sentence about the allowance, or null when it is not worth saying.
 *
 * Reason: a tool result is the prompt for whatever the AI client says next, so
 * anything returned here gets repeated to the user, and once "6 of 300" is in
 * the transcript the client keeps repeating it in later turns. So no tool
 * quotes the tally unprompted — every caller that touches the allowance goes
 * through here, and it stays quiet until the next card may actually be refused.
 *
 * @param quota - The caller's current allowance
 * @returns A line to append to a success message, or null to say nothing
 */
export const describeLowAllowance = (quota: PrivateCardQuota): string | null =>
  quota.remaining > LOW_ALLOWANCE_THRESHOLD
    ? null
    : `Worth mentioning: only ${quota.remaining} private card${quota.remaining === 1 ? '' : 's'} ` +
      `left this month on the ${quota.plan} plan. The quota resets on the 1st.`;

/**
 * How many private cards the signed-in user has left this month.
 *
 * Reason: asks the database rather than counting here. The plan ladder and the
 * window belong to `enforce_monthly_private_card_limit`, which is the gate that
 * actually refuses a card, and this used to be a hand-kept copy of both. Drafts
 * are the case that made the copy untenable: they are rows the user has not
 * asked for yet, so counting them here would have quoted an allowance smaller
 * than the one being enforced.
 *
 * @param supabase - Client acting as the signed-in user
 * @returns Their plan, what they have used, and what is left
 */
export const fetchPrivateCardQuota = async (
  supabase: SupabaseClient,
): Promise<PrivateCardQuota> => {
  const { data, error } = await supabase.rpc('private_card_quota').maybeSingle();

  if (error || data === null) {
    // Reason: quoting the free allowance beats refusing to answer. The number
    // is only ever used to decide whether to mention the allowance at all, and
    // the database refuses the card regardless of what is said here.
    return UNKNOWN_QUOTA;
  }

  const row = data as PrivateCardQuotaRow;
  return {
    plan: row.plan,
    used: row.used,
    limit: row.monthly_limit,
    remaining: row.remaining,
  };
};
