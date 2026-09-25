# Inoh for Grok Bot

Practice English vocabulary in chat and keep your progress in sync with [Inoh](https://inoh.app).
Save words to your decks, quiz yourself on today's cards, or work on the words you keep forgetting.

This plugin connects to Inoh's hosted MCP server and includes a vocabulary skill. It needs no
local server, package installation, or API key. You need an [Inoh account](https://app.inoh.app).

## Connect

After marketplace approval, find **Inoh** in Grok Bot's **Plugins** search, install it, and finish
the Inoh sign-in flow in your browser. The plugin supplies the server address automatically.
Availability depends on marketplace review and any team policy.

The package uses Cursor's plugin format for marketplace submission and local testing.

For local testing before publication, copy this entire directory, including `.cursor-plugin`,
to `~/.cursor/plugins/local/inoh`, then reload Cursor and open **Customize**. Confirm that the
`inoh` MCP server and `inoh` skill appear. Copy the files rather than creating a symlink
to a directory outside `~/.cursor/plugins/local`; Cursor skips those symlinks.

Ask which Inoh account you are signed in as to check the connection. Finish authentication in
your browser if prompted.

## Try it

- "Quiz me on today's Inoh words, one at a time."
- "Help me practice the words I keep forgetting."
- "Add serendipity to my Inoh deck."
- "Make me a card for runway in the startup cash sense."
- "Do I already have this word in my deck?"

Review answers update the same schedule used by the app. Saving or creating cards changes your
Inoh account. Removing cards resets their review progress; deleting private cards is permanent.
The skill asks for confirmation before those actions.

Your Inoh plan's weekly MCP and monthly private-card allowances apply. You can use your preferred
language for the conversation; generated vocabulary cards teach English words and phrases.

## Authentication and support

The remote connection uses OAuth. Credentials belong in the browser sign-in flow, never in this
package or a chat message. The server scopes tools to the signed-in Inoh account.

See [Inoh's connection guide](https://docs.inoh.app) for setup and troubleshooting, or
[open an issue](https://github.com/inoh-app/inoh-mcp/issues) for a plugin problem.

## Publication status and license

This package is prepared for submission and is not yet a published marketplace listing.

This plugin package is licensed under the [MIT License](LICENSE). The repository's marketplace
manifest is covered by the same license. The hosted MCP server source retains its existing
all-rights-reserved license.
