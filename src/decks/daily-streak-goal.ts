import type { SupabaseClient } from '@supabase/supabase-js';

/** The same daily goal state shown in the Inoh app. */
export interface DailyStreakGoal {
  goal_target: number;
  goal_progress: number;
  status: 'open' | 'earned' | 'protected' | 'empty';
  current_streak: number;
  has_more_to_review: boolean;
}

/** Reads the shared streak goal for the signed-in learner. */
export const fetchDailyStreakGoal = async (supabase: SupabaseClient): Promise<DailyStreakGoal> => {
  const { data, error } = await supabase.rpc('get_daily_streak_status');
  if (error) throw new Error(`Could not read today's streak goal: ${error.message}`);
  return data as DailyStreakGoal;
};

/** Describes progress without exposing the due backlog as a second goal. */
export const describeDailyStreakGoal = (goal: DailyStreakGoal): string => {
  if (goal.status === 'earned') {
    const continueNote = goal.has_more_to_review
      ? ' Offer another review session if they want to continue.'
      : '';
    return `Today's streak goal is complete (${goal.goal_progress}/${goal.goal_target}).${continueNote}`;
  }
  if (goal.status === 'protected') {
    return (
      `There is nothing to review today. Their ${goal.current_streak}-day streak is protected ` +
      'at the same count. Offer random words for optional practice; that practice does not raise the streak.'
    );
  }
  if (goal.status === 'empty') {
    return (
      'There is nothing to review today. Offer random words for optional practice; ' +
      'that practice does not earn a streak day.'
    );
  }
  return (
    `Today's streak goal: ${goal.goal_progress}/${goal.goal_target} distinct words reviewed. ` +
    'Reviews from any deck count. Continue until the goal is complete.'
  );
};
