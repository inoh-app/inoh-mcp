/**
 * How badly a word may be typed and still be recognised. Mirrors the app's
 * `getMaxLevenshteinDistance` and the thresholds baked into
 * `search_dictionary_words`, so a near miss is forgiven the same way wherever
 * it is typed: one edit on a short word, three on a long one.
 */
const SHORT_WORD_MAX_LENGTH = 6;
const MEDIUM_WORD_MAX_LENGTH = 12;
const SHORT_WORD_EDIT_DISTANCE = 1;
const MEDIUM_WORD_EDIT_DISTANCE = 2;
const LONG_WORD_EDIT_DISTANCE = 3;

/**
 * How far a word may sit from the query and still count as the same word
 * misspelled.
 *
 * @param queryLength - Length of the word being searched for
 * @returns The largest edit distance that still counts as a match
 */
export const allowedEditDistance = (queryLength: number): number => {
  if (queryLength <= SHORT_WORD_MAX_LENGTH) {
    return SHORT_WORD_EDIT_DISTANCE;
  }

  return queryLength <= MEDIUM_WORD_MAX_LENGTH
    ? MEDIUM_WORD_EDIT_DISTANCE
    : LONG_WORD_EDIT_DISTANCE;
};

/**
 * Levenshtein distance: how many single-character insertions, deletions or
 * substitutions turn one word into the other.
 *
 * Reason: written out here rather than pulled in as a dependency or borrowed
 * from Postgres. The app uses `fast-levenshtein` and the database uses
 * fuzzystrmatch, but this server compares at most 50 short words per search,
 * and its dependency list is something people audit.
 *
 * @param first - One word, already lowercased by the caller
 * @param second - The other word, already lowercased by the caller
 * @returns The number of edits between them
 */
export const measureEditDistance = (first: string, second: string): number => {
  // Reason: the standard matrix, kept one row at a time. Filling row N only
  // ever reads row N-1, so the rows above it are never needed.
  let previousRow = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const currentRow = [firstIndex];

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      const insertion = (currentRow[secondIndex - 1] ?? 0) + 1;
      const deletion = (previousRow[secondIndex] ?? 0) + 1;
      const substitution = (previousRow[secondIndex - 1] ?? 0) + substitutionCost;

      currentRow[secondIndex] = Math.min(insertion, deletion, substitution);
    }

    previousRow = currentRow;
  }

  return previousRow[second.length] ?? 0;
};
