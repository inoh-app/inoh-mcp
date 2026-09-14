import * as z from 'zod/v4';
import { MAX_WORD_LENGTH, WORD_CHARACTER_REGEX } from '../constants.js';

/** Longest sense hint a request accepts. */
const MAX_CONTEXT_LENGTH = 300;

/** Canonical apostrophe (U+0027), the one the Inoh dictionary stores. */
const CANONICAL_APOSTROPHE = "'";

/**
 * Apostrophe-like characters that mean the same thing as U+0027.
 *
 * Mirrors APOSTROPHE_VARIANTS in the Inoh app: iOS keyboards produce U+2019,
 * and a model writing prose is just as likely to.
 */
const APOSTROPHE_VARIANTS = /[‘’ʼʹ]/g;

/**
 * Rewrite curly and modifier apostrophes as U+0027.
 *
 * Reason: runs before the character check so "one’s own" is accepted rather
 * than read as a foreign script, and before the word reaches the dictionary
 * lookup and the request row, which both compare against U+0027.
 *
 * @param word - The word as the caller sent it
 * @returns The same word with one kind of apostrophe
 */
const _normalizeApostrophes = (word: string): string =>
  word.replace(APOSTROPHE_VARIANTS, CANONICAL_APOSTROPHE);

/**
 * The word a card is to be made for, as every tool that asks for one takes it.
 *
 * Shared because the rule is the generator's and not any one tool's: Inoh only
 * builds English cards, whichever dictionary the card is headed for. Call
 * `.describe()` on it to say what the word means in a particular tool.
 */
export const cardWordSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_WORD_LENGTH)
  .transform(_normalizeApostrophes)
  .refine((word) => WORD_CHARACTER_REGEX.test(word), {
    message:
      'Inoh generates cards for English words, so the word to teach has to be in English. The ' +
      'user can ask in any language, and `context` can be in any language too — only this ' +
      'word is restricted.',
  });

/**
 * Which sense of the word to teach.
 *
 * Optional everywhere: each tool falls back to buildDefaultContext, because
 * `card_requests.context` is NOT NULL and is what the generator works from.
 * Call `.describe()` on it to say what a good hint looks like for the tool at
 * hand.
 */
export const cardContextSchema = z.string().trim().min(1).max(MAX_CONTEXT_LENGTH).optional();
