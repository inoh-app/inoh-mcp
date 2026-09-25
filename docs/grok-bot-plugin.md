# Grok Bot plugin publication

The repository contains a Grok Bot plugin in `plugins/grok-bot/`, packaged in Cursor's plugin
format. The root `.cursor-plugin/marketplace.json` points Cursor's marketplace at that directory,
so the submission can use `https://github.com/inoh-app/inoh-mcp`. The plugin contains only its
manifest, hosted MCP connection,
vocabulary skill, README, license, and logo; it does not need the server's TypeScript sources or
dependencies.

The plugin package and root marketplace manifest are licensed under the
[MIT License](../plugins/grok-bot/LICENSE). The [repository license](../LICENSE) explicitly limits this
exception to those files; the MCP server source retains its existing all-rights-reserved license.

## Before submitting

1. Complete the remaining sign-in and account checks below.
2. Commit and push the plugin files and scoped license exception to the public repository. The
   publishing form reads the files on GitHub.
3. Submit the repository at [Cursor's publishing page](https://cursor.com/marketplace/publish).
   Listing and subsequent updates require Cursor's review; submission is not approval.

## Test the package in Cursor

1. Copy the complete `plugins/grok-bot/` directory to `~/.cursor/plugins/local/inoh`. Include hidden
   files, especially `.cursor-plugin/plugin.json`. Inspect an existing local copy before replacing
   anything. A symlink back to this repository will not load.
2. Reload Cursor and open **Customize**. Confirm the `inoh` MCP server and `inoh` skill.
   If an older standalone Inoh connection is enabled, temporarily disable it so this test exercises
   the plugin connection. A marketplace installation with the same name takes precedence over
   a local plugin. Team policy may also restrict local plugin imports.
3. Ask "Which Inoh account am I signed in as?" and complete browser authentication. Confirm the
   returned account. This account check does not consume the weekly tool allowance.
4. With a test account, ask "Quiz me on today's Inoh words." Confirm one question appears at a time,
   the answer is hidden until you respond, and one review is saved per answer. Check the app's
   review progress. This test updates the account and consumes tool calls.
5. Ask "Add serendipity to my Inoh deck." Confirm the existing dictionary card is used when it
   covers the requested meaning and the card appears in the app. This also changes the test account.

JSON and skill validation cannot establish that the client loads the plugin or that its browser
OAuth flow completes. Those checks require an actual Cursor session. After listing, also verify
search, installation, and authentication in Grok Bot.

### Validation on 25 September 2026

- Strict lint, TypeScript checks, and formatting checks passed.
- Package checks passed for manifest paths, MCP configuration, skill YAML and tool references,
  and the logo dimensions. The skill-creator Python validator could not run because PyYAML was
  unavailable; frontmatter was checked with the project's installed `js-yaml` dependency instead.
- The hosted MCP endpoint returned a `401` with its OAuth discovery challenge, and its public
  protected-resource metadata was reachable.
- Cursor 3.21.18 loaded a copy at `~/.cursor/plugins/local/inoh` and displayed **Inoh 0.1.0**,
  **MCPs 1**, and **Skills 1**. The connection showed **Needs authentication**.
- Browser sign-in, account verification, and review/card mutations remain untested in Cursor.
  Marketplace submission is still pending.

## Publisher form

| Field               | Value                                |
| ------------------- | ------------------------------------ |
| Organization name   | Inoh                                 |
| Organization handle | inoh                                 |
| Contact email       | tai@inoh.app                         |
| Logotype URL        | https://inoh.app/images/icon-512.png |
| GitHub repository   | https://github.com/inoh-app/inoh-mcp |
| Website URL         | https://inoh.app                     |

The logo URL is a verified 512 × 512 PNG with a background plate. A copy is included at
`plugins/grok-bot/assets/logo.png` for the plugin manifest. The homepage URL is not an image URL.

Suggested description:

> Practice English vocabulary in chat with Inoh. Quiz yourself on today's cards, the words you
> keep forgetting, or a random set, with each review updating your schedule in the Inoh app.
> Add words you encounter using existing dictionary cards, or create a private card for a new
> word or meaning. Requires an Inoh account; plan usage limits apply.

## References

- [Plugin creation and local testing](https://cursor.com/docs/plugins)
- [Manifest reference and submission checklist](https://cursor.com/docs/reference/plugins)
- [Grok Bot plugin installation](https://cursor.com/help/grok-bot/connect-plugins)

This package targets Cursor's marketplace and the Grok Bot plugin flow. The existing manual
Grok CLI setup at [docs.inoh.app](https://docs.inoh.app/#grok-cli) is a separate installation path.
