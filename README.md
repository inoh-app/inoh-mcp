# inoh-mcp

The remote [MCP](https://modelcontextprotocol.io) server for [Inoh](https://inoh.app) — the vocabulary
app for the articulate. Connect it to Claude, ChatGPT, Cursor or any MCP-capable client and
your AI can look words up in the Inoh dictionary and build flashcards for you, in your own account,
while you are talking to it.

Ask for a word you just met in an article and it becomes a card with a definition, an example
sentence, audio, an image and quiz options, ready to review in the Inoh app on your phone.

A word can sit in several decks. Its review progress is shared, and each deck placement counts
as one card toward the account's plan limit. Removing it from one deck keeps that progress while
another deck still contains it. Deploy the related `inoh-backend` migrations before deploying this
server.

```
https://mcp.inoh.app/mcp
```

## Connecting

You need a free [Inoh](https://app.inoh.app) account. Sign-in happens in your browser through Inoh's
normal email flow, so your AI client never sees your password, and you can revoke access at any
time from your Inoh account settings.

Step-by-step instructions for Claude, Cursor, ChatGPT, Gemini, VS Code and more are at
[docs.inoh.app](https://docs.inoh.app). The address and troubleshooting are also in
[docs/installation.md](docs/installation.md).

## Grok Bot plugin

The [Inoh plugin](plugins/grok-bot/README.md) packages the hosted MCP connection and a vocabulary
skill for Grok Bot. It uses Cursor's plugin format and marketplace. Its manifest supplies the
server address, so users can connect through the plugin's browser sign-in flow. The root
`.cursor-plugin/marketplace.json` points to the standalone package in `plugins/grok-bot/`.
Plugin packages are organized by target client under `plugins/`; each package connects to the
same hosted MCP server.

The plugin is MIT-licensed and is not yet listed. A signed-in client test and marketplace review
are still required. See [publication and testing](docs/grok-bot-plugin.md) for the steps and publisher
form values.

## What you can ask for

| Tool                    | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `search_dictionary`     | Look a word or phrase up, public dictionary and your own cards |
| `search_deck`           | Search the words you already have, across your decks or one    |
| `browse_deck`           | Pull words out of your deck with no search term at all         |
| `record_review`         | Save how well you remembered a word while reviewing            |
| `add_card_to_deck`      | Put a card that already exists into one of your decks          |
| `remove_card_from_deck` | Take a card back out of your deck, keeping the card itself     |
| `create_private_card`   | Build a complete flashcard for a word and file it in your deck |
| `update_private_card`   | Remake a card you made, keeping its review progress            |
| `request_public_card`   | Ask for a word to be added to the dictionary everyone shares   |
| `check_card_status`     | Check where a card or a request you made has got to            |
| `delete_private_card`   | Destroy a card you made, for good                              |
| `check_account`         | Show which Inoh account you are signed in as                   |

Things people actually say:

- "Add _serendipity_ to my Inoh deck."
- "I keep seeing _runway_ in startup writing. Make me a card for that meaning, not the airport one."
- "Make cards for every word I got wrong in that article."
- "Is my _platitudinous_ card ready yet?"
- "Do I already have _serendipity_ in my deck?"
- "Give me ten random words from my deck."
- "What have I added to my deck lately?"
- "What should I review today?"
- "Quiz me on today's words."
- "Which words do I keep forgetting?"
- "Have I got any _get_ phrasal verbs in my deck?"
- "Take _banyan_ out of my deck, I know it now."
- "My _moat_ card explains the wrong thing - redo it for the business sense."
- "That picture on my _runway_ card is useless. Make the card again."
- "Delete the _moat_ card I made earlier."
- "Put the _banyan_ card back in my deck."
- "Inoh hasn't got _enshittification_. Can you get it added for everyone?"
- "Did that word I suggested ever make it into the dictionary?"

Ask for a word and the AI looks it up first, adding the public dictionary's card when Inoh already
has one and generating a fresh one only when it does not.

`search_deck` looks through the words you hold rather than the ones you could add, so it answers
"do I have this already?" without the dictionary's 45,000 entries drowning your own cards out. It
forgives a typo the same way the app's search does, and it tells you which deck a word is in.

`browse_deck` is the one to reach for when there is no word to search for. Ask for a random
handful and you get a different draw every time; ask for the newest or the oldest and you get
them in the order you added them; ask what to review and you get today's review session, the same one
the app would deal: new cards and words scheduled by the end of your day; ask what you keep forgetting and you get the cards you have missed in review, the
worst first. Reading your deck this way never touches a card's review schedule.

## Reviewing in a conversation

Ask the AI to quiz you and it works through today's session however suits the conversation: it
might say a word and ask what it means, give you a meaning and ask for the word, or use it in a
sentence. After each answer it judges how well you remembered it (you had it, you half had it, or
you didn't) and `record_review` saves that straight away, so stopping halfway loses nothing.

A review here counts exactly like one in the app. The word is scheduled by the same rules and won't
come back until it is due again. Today's streak goal is 10 distinct words across all decks and clients,
or every word ready for review if fewer than 10 are ready. New cards are ready immediately. A
one-word deck session does not finish the goal when other decks have words to review. The MCP server
reports goal progress after each answer and offers another session when words remain.

When nothing is ready to review, an existing streak stays at the same count. The server says so and
offers random words for optional practice; that practice does not raise the streak.

A session is up to 10 words, the same session the app deals: at least three new words when there
are any, scheduled words for the rest, and no new words while more than 20 scheduled words are
due, so a learner who is behind catches up first. When the goal is complete, the learner can still
start another session if more words are ready.

## Your weekly allowance

Your plan includes a weekly allowance of MCP tool calls. A tool call is one thing your AI assistant
does in Inoh for you: recording one answer, adding or looking up a word. Taking today's session and
checking which account you're signed in as are free, so a full session of 10 words uses 10. The
allowance resets on Monday at midnight where you are.

| Plan | Tool calls a week | About                                         |
| ---- | ----------------- | --------------------------------------------- |
| Free | 35                | 3 review sessions a week, with 5 calls spare  |
| Plus | 150               | 15 review sessions a week (about two a day)   |
| Pro  | 500               | 50 review sessions a week (about seven a day) |

Adding, searching and browsing use tool calls too. When only a few are left the AI mentions it, and
once they're gone it tells you when they come back and where to upgrade.

## Removing versus deleting

These are different things, and the tools keep them apart.

**Removing** a card from your deck ends your review of it and nothing more. A public dictionary
card stays in Inoh for everyone; a card you made stays in your own private dictionary. Either way
you can add it back whenever you like, though you start its review progress over. This is what
`remove_card_from_deck` does, for both kinds of card.

**Deleting** applies only to cards you made, and it is permanent: the card leaves your private
dictionary, and its image and audio are destroyed with it. There is no undo. Asking for the word
again later makes a brand new card, spending another of your monthly allowance, so the AI will
check with you before deleting anything. If the card is simply wrong rather than unwanted,
`update_private_card` remakes it in place and keeps your review progress.

## Cards you create

A card you make here is yours alone. It goes into your **private dictionary**, which only you can
see: it never joins the public Inoh dictionary, and never shows up in anyone else's feed or search.
Two people asking for the same word each get their own.

It is a complete card rather than a stub: definition, example sentence, three audio clips, an image,
phonetic transcription and both sets of quiz options. That means you can review it in the app the
moment it appears, alongside the public dictionary's cards — and it shows up in the app's
Dictionary tab under Private, badged as yours. Making one takes about 20 seconds.

Tell the AI which sense you mean when a word has several. "Runway" as months of cash is a different
card from "runway" at an airport, and nothing reviews the result before it reaches you.

If Inoh already has the word — or you made a card for it before — generating stops before it starts
and points you at that card. A public dictionary card is written and checked by Inoh, and adding one
costs nothing against your monthly allowance, so it is the better choice nearly always. When you really do want your own card
for a sense the existing one does not cover, say so and the AI can go ahead anyway.

**How many you can make**, per calendar month:

| Plan | Cards per month |
| ---- | --------------- |
| Free | 50              |
| Plus | 300             |
| Pro  | 1,000           |

### When a card comes out wrong

Ask for it again rather than deleting it. `update_private_card` regenerates the definition, example
sentence, image, audio and quiz options and writes them over the same card, so **the card keeps its
place in your deck and everything Inoh knows about how well you remember it**. Deleting and remaking
would throw that away and start the word over.

Say which sense you meant and it teaches that instead. Say nothing and it simply has another go at
the sense it already had, which is what you want when the meaning was right but the sentence was
flat or the picture unhelpful.

A redo costs one card from your monthly allowance, because it generates a new image - the expensive
part of a card. It cannot change which word the card teaches: that is a different card, so delete
this one and make that one.

### Deleting

Deleting a card removes it completely: the card, its place in your deck, and its image and audio
files. It does not give back the monthly allowance it used. Removing one of your own cards from a
deck inside the Inoh app also deletes it, a few minutes later, once the undo window has passed.

## Contributing to the public dictionary

Everything above is about your own cards. The public dictionary — the 45,000 entries every Inoh
user shares — is the other half, and you can add to it. Say the dictionary ought to have a word
and the AI sends it in for you, with the sense you described.

What happens then is different from making your own card in one important way: **a person at Inoh
reads it before anything is published.** Inoh builds the card as usual, then it waits for a
reviewer, so this takes days rather than a minute, and it can be turned down. If it is published,
the card belongs to everyone who uses Inoh — and it is added to your deck too, so you are not
waiting on your own suggestion to study the word.

Suggestions spend none of your monthly private-card allowance, so suggesting a word never uses up
a card you might want for yourself. (One ceiling
does apply: 100 requests a day across everything you ask Inoh to make, which exists to stop a
runaway script rather than you.)

**Which one to ask for:**

| You want                      | Ask for            | You get it                     |
| ----------------------------- | ------------------ | ------------------------------ |
| The word in your deck today   | A card of your own | In about a minute, guaranteed  |
| The word in Inoh for everyone | A request          | In a few days, if it is agreed |

Nothing stops you doing both — make yourself a card now, and suggest the word as well. If the
dictionary already has the word there is nothing to contribute, and the AI will offer you the
existing card instead; say you mean a different sense and it can send the request anyway.

Ask "where did my suggestion get to?" and `check_card_status` answers for both kinds at once: your
own cards read as ready, a suggestion reads as with a reviewer, published, or declined. The app's
My Requests screen shows the same list.

## Privacy and data handling

- **The server stores nothing of its own.** It acts on your Inoh account using your access token,
  and everything it reads or writes is scoped to you by the database's row level security.
- **It holds no administrator credentials.** There is no service-role key here, so a bug in a tool
  cannot reach past your own data.
- **It logs no card content, no request bodies and no tokens.** The only things written to the log
  are the startup line, rejected origins, and unexpected errors.
- **Creating a card sends the word and the sense you described to Inoh's card pipeline**, which uses
  OpenAI for the text, Google Cloud for the speech, and Google Gemini for the image. Nothing else
  about you is sent.
- **A word you suggest for the public dictionary is read by a person at Inoh**, along with the sense
  you wrote, because that is what reviewing it means. The published entry carries no trace of who
  asked for it.
- **Your cards stay yours.** Deleting a card deletes the underlying media too, unless another card
  legitimately shares the same file.
- **You can revoke access at any time** from your Inoh account, and nothing here survives it.

## Security

Requests are authenticated with OAuth 2.1 bearer tokens; an unauthenticated request gets a `401`
pointing at the server's protected-resource metadata, which is how MCP clients discover the sign-in
flow. The `/mcp` endpoint also validates the `Origin` header, so a web page cannot drive the server
from your browser.

Found something wrong? Open an issue on this repository.

## Licence

The MCP server source is published so you can audit what it does with your account and remains
all rights reserved. See [LICENSE](LICENSE). Connecting to the hosted server needs no licence.

The standalone plugin in `plugins/grok-bot/` and `.cursor-plugin/marketplace.json` are licensed under
the [MIT License](plugins/grok-bot/LICENSE). This exception does not apply to the server source.

## Push checks

Every push to `main`, including a pull request merge or a direct push, starts the Push checks workflow in GitHub Actions. The quality job checks formatting and lint. The AI job reviews the changed source code using this repository's `CLAUDE.md` and its `ANTHROPIC_API_KEY` Actions secret. These checks run after the change reaches `main`; feature-branch pushes do not start them.

If quality fails or AI review reports findings without edits, inspect the Actions run and make a follow-up fix. If Claude edits code, Actions validates the edits and opens an `ai-fix/*` pull request targeting `main`. The AI job stays green, because the fix PR is the signal; only a review that finds problems it cannot fix turns it red. Review and merge that PR manually.

If `main` advances while an AI fix PR is open, the next AI review rechecks the unresolved changes alongside the new push. It opens a replacement PR from the newer reviewed commit, then closes the old PR. If no fix remains, it closes the old PR; if review fails, the old PR stays open. AI fix PRs do not run this main-only workflow, so check the replacement against the latest `main` and resolve conflicts before merging. Merging starts a new Push checks run.
