/** What an Inoh edge function answers with when it refuses or fails. */
export interface EdgeFunctionRefusal {
  error?: string;
  /** A stable name for the refusal, e.g. `DAILY_REVIEW_LIMIT`, when the function gives one. */
  code?: string;
}

/**
 * The body an edge function refused with, if it refused rather than broke.
 *
 * Reason: supabase-js turns any non-2xx into an error whose message is only
 * "Edge Function returned a non-2xx status code", and hangs the real response
 * off `context`. The function's own message is the useful one — "Card not
 * found. It may already have been deleted." — so it is read back out here
 * rather than thrown away.
 *
 * The response is recognised by having a `json()` rather than by
 * `instanceof Response`: this package compiles against `lib: ES2022` with only
 * Node types, where that global is not guaranteed to be a type.
 *
 * @param error - What functions.invoke returned
 * @returns The function's refusal, or null when this was not one
 */
export const readEdgeFunctionRefusal = async (
  error: unknown,
): Promise<EdgeFunctionRefusal | null> => {
  const { context } = error as { context?: { json?: () => Promise<unknown> } };
  if (typeof context?.json !== 'function') return null;

  try {
    return (await context.json()) as EdgeFunctionRefusal;
  } catch {
    return null;
  }
};
