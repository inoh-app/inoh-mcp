import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How many of the user's cards are paused: beyond their plan limit, so left
 * out of every review until they upgrade (PRI-21123).
 *
 * @param supabase - Client acting as the signed-in user
 * @param deckId - One deck to count, or undefined for all of them
 * @returns The number of paused cards
 * @throws {Error} When the count fails
 */
export const countPausedCards = async (
  supabase: SupabaseClient,
  deckId: string | undefined,
): Promise<number> => {
  const query = supabase
    .from('user_cards')
    .select('id', { count: 'exact', head: true })
    .eq('is_review_paused', true);
  const { count, error } = await (deckId === undefined ? query : query.eq('deck_id', deckId));

  if (error) {
    throw new Error(`Could not count the user's paused cards: ${error.message}`);
  }
  return count ?? 0;
};
