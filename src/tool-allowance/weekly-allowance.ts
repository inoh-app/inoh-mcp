import type { SupabaseClient } from '@supabase/supabase-js';
import { PLANS_URL } from '../web-app-urls.js';

export interface WeeklyToolCallAllowance {
  /** Whether this call was counted and may run. */
  isAllowed: boolean;
  /** The plan the allowance came from: free, plus or pro. */
  plan: string;
  weeklyLimit: number;
  remaining: number;
}

/** Shape `consume_mcp_tool_call` returns. */
interface ConsumedToolCallRow {
  allowed: boolean;
  plan: string;
  weekly_limit: number;
  remaining: number;
}

/**
 * How few calls left before the allowance is worth raising unprompted.
 *
 * Reason: the same rule as the private-card allowance. A tally the user did
 * not ask about is noise until the next call may be refused.
 */
const LOW_ALLOWANCE_THRESHOLD = 5;

const PLAN_NAMES: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };

/**
 * "MCP tool call" is the term the pricing uses, so the messages use it too,
 * with what it means said once for someone who has never heard it.
 */
const TOOL_CALL_EXPLANATION =
  'A tool call is one thing an AI assistant does in Inoh for them, like recording an answer.';

/**
 * Where a refused learner can carry on today.
 *
 * Reason: reviews in the app are unlimited on every plan, so running out here
 * never has to end their practice, only move it.
 */
const APP_FALLBACK = 'You can keep reviewing in the Inoh app in the meantime.';

/**
 * What the next plan up buys, said in review sessions rather than calls.
 *
 * Reason: a "call" means nothing to a learner. A session every day is what
 * Plus is sold on, so the refusal says so. Pro has nowhere to go.
 */
const NEXT_PLAN_PITCH: Record<string, string> = {
  free: 'Inoh Plus covers a review session every day',
  plus: 'Inoh Pro covers several review sessions a day',
};

/**
 * Counts one tool call against the signed-in user's weekly allowance.
 *
 * Reason: the database does the counting, the refusing and the week, so the
 * plan ladder and the Monday reset exist in one place. When the counter cannot
 * be reached the call is let through: the allowance is a pricing gate, not a
 * security one, and a broken counter must not take every tool down with it.
 *
 * @param supabase - Client acting as the signed-in user
 * @returns Whether the call may run, and what is left
 */
export const consumeWeeklyToolCall = async (
  supabase: SupabaseClient,
): Promise<WeeklyToolCallAllowance> => {
  const { data, error } = await supabase.rpc('consume_mcp_tool_call').maybeSingle();

  if (error || data === null) {
    return {
      isAllowed: true,
      plan: 'free',
      weeklyLimit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
    };
  }

  const row = data as ConsumedToolCallRow;
  return {
    isAllowed: row.allowed,
    plan: row.plan,
    weeklyLimit: row.weekly_limit,
    remaining: row.remaining,
  };
};

/**
 * The reply when this week's allowance is spent.
 *
 * @param allowance - The refused call's allowance
 * @returns A message written for the user, with where to upgrade when there is
 *   a plan above theirs
 */
export const describeSpentAllowance = (allowance: WeeklyToolCallAllowance): string => {
  const planName = PLAN_NAMES[allowance.plan] ?? allowance.plan;
  const spent =
    `All ${allowance.weeklyLimit} MCP tool calls in this week's ${planName} plan allowance are ` +
    `used up. ${TOOL_CALL_EXPLANATION} They reset on Monday. ${APP_FALLBACK}`;
  const pitch = NEXT_PLAN_PITCH[allowance.plan];
  return pitch === undefined ? spent : `${spent} ${pitch}. Upgrade at ${PLANS_URL}`;
};

/**
 * A sentence about the allowance, or null when it is not worth saying.
 *
 * @param allowance - The allowance after this call
 * @returns A line to append to the tool's result, or null to say nothing
 */
export const describeLowWeeklyAllowance = (allowance: WeeklyToolCallAllowance): string | null =>
  allowance.remaining > LOW_ALLOWANCE_THRESHOLD
    ? null
    : `Worth mentioning: only ${allowance.remaining} MCP tool call${allowance.remaining === 1 ? '' : 's'} ` +
      `left this week on the ${PLAN_NAMES[allowance.plan] ?? allowance.plan} plan. ` +
      `${TOOL_CALL_EXPLANATION} They reset on Monday.`;
