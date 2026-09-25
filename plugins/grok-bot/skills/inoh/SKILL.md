---
name: inoh
description: Practice English vocabulary with Inoh, save words to the user's decks, and manage their flashcards. Use when the user asks to review or quiz their Inoh words, study words they keep forgetting, add a word to Inoh, or check or change an Inoh card.
---

# Inoh

Use the connected Inoh MCP tools and their current schemas. If the connection needs authentication,
direct the user to the plugin's sign-in flow. Use `check_account` when they want to verify the
connection or which account is signed in. Never ask them to paste a password, email code, or token
into chat.

Refer to words, meanings, and decks in conversation; keep tool names and internal IDs out of
user-facing replies. Use IDs returned by the tools when acting on cards. If several cards could
match, distinguish them by their definitions and ask which meaning the user intends.

## Practice vocabulary

For today's review, call `browse_deck` with `selection: "due"`. For words the user keeps missing,
use `"struggling"`; for a random practice set, use `"random"`. Respect a requested deck or count.
Fetch the set once and work from the returned cards. Mention any additional due cards reported
by the server without implying that finishing this set completes the whole day.

Quiz one card at a time and wait for the user's answer before revealing the solution. Adapt to
their preferred format: recall a word from its meaning, explain a word, use it in a sentence, or
discuss its meaning. Explanations and prompts may be in the user's preferred language; Inoh
generates English vocabulary cards.

After an actual recall attempt, judge the answer and call `record_review` once for that card:

- `remembered`: they recalled it correctly.
- `partly_remembered`: they recalled part of it, needed a hint, or were unsure.
- `forgot`: they did not know it or answered incorrectly.

When uncertain between outcomes, use the lower one. Explain a missed answer briefly, then continue.
Do not record a review for merely listing, explaining, or discussing a word without a recall
attempt. Do not retry an ambiguous recording failure automatically: separate calls can save
duplicate reviews. Explain when an answer could not be confirmed as saved.

## Save words

Use `search_dictionary` to find a requested word or phrase. Choose a matching meaning from the
returned cards and use `add_card_to_deck` to save it. Prefer an existing public entry or the user's
existing private card when it covers the intended meaning.

If no suitable card exists, use `create_private_card` with the English word and the context that
identifies the intended meaning. Context can stay in the user's language. Do not override a
duplicate warning unless the user wants a separate card for a different sense. Card generation
finishes in the background; describe it as pending until `check_card_status` reports it ready.
Use the returned request ID when checking a specific request, and avoid repeated polling.

Use `request_public_card` only when the user asks to contribute a word to the shared dictionary.
Those suggestions need human review; do not promise publication or use them as a substitute for
a requested private card.

## Find or change cards

Use `search_deck` for questions about words the user already holds. Use `browse_deck` with
`"newest"` or `"oldest"` when they ask about when words were added. Browsing alone does not change
review progress.

Use `update_private_card` to remake a private card with a wrong meaning or unhelpful content;
this preserves its review progress and consumes a private-card generation allowance. Public
dictionary cards cannot be remade or deleted by the user.

Removing a card from a deck loses its review progress but keeps the card in the dictionary.
Deleting a private card permanently removes the card and its media. Explain the applicable
consequence and obtain confirmation before using `remove_card_from_deck` or `delete_private_card`.
If the user already confirmed that consequence for this card, proceed without asking again.

## Respect usage limits

Every tool call except `check_account` uses the account's weekly MCP allowance. Take a review
set once and record each answer without extra lookups. Creating or remaking private cards also
uses a monthly generation allowance. Follow the server's current allowance and reset messages;
do not invent limits, claim success after a refusal, or keep retrying an exhausted allowance.
