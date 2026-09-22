# Codex Daybook 0.5.7 — local release candidate

Desktop Obsidian plugin that saves completed local **Codex Desktop** conversations as Markdown notes and links them into your daily Dataview trail. Not a ChatGPT history importer: it only handles local Codex Desktop main tasks, and only tasks created after you start sync are ever captured.

Public release candidate. Source is at [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync), licensed under MIT. **Windows hardware validation and community-directory review are not yet complete; a release candidate is not a marketplace listing.**

[Chinese guide](README.md) · [privacy](PRIVACY.md) · [changelog](CHANGELOG.md)

## Setup

Requires Obsidian 1.13.7+, enabled Dataview, and a local Codex Desktop installation.

1. Extract the installation ZIP into your vault's `.obsidian/plugins/`, keeping the `codex-daily-sync` folder.
2. Enable Dataview and this plugin in Obsidian's community plugins settings.
3. First activation only shows settings: notes folder, attachments folder, daily folder, optional daily template, time zone, and check interval (default 10s, 5–3600s).
4. Acknowledge outside-vault access, click **Log in to Codex** to sign in with ChatGPT, then **Check connection** to verify the interface. If no verifiable main task exists yet, finish a test task in Codex first.
5. Once the check passes, click **Start sync**. This fixes the sync starting point — only Codex main tasks created afterward are captured.

The Codex executable is auto-detected by default; if detection fails, select it manually under Advanced settings — only choose an executable you trust, since it runs with your account's permissions. The interface supports Simplified Chinese and English, switchable from Language in settings; this only changes the interface text, never synced note content.

## What gets synced

Only completed-turn user messages, final answers, and formal plans are exported; tool calls, reasoning, system messages, and in-progress or failed turns are never exported. Local PNG/JPEG/GIF/WebP images are copied into the vault and deduplicated by content; remote images are never downloaded. Each task freezes its own folders, time zone, and creation day, so later setting changes don't affect existing notes. Settled, unchanged conversations never rewrite notes; personal text outside the synced content is preserved. Archiving or deleting the source conversation never automatically removes local notes, images, or daily links.

## Sign-in

Login uses Codex's official browser authorization flow; passwords and tokens never pass through the plugin or get written to the vault. See [privacy](PRIVACY.md) for details.

## Development

```sh
npm ci
npm run package
```

See [RELEASE.md](RELEASE.md) for the release/acceptance process and [CHANGELOG.md](CHANGELOG.md) for version history.

More docs: [Windows checklist](WINDOWS-CHECKLIST.md) · [validation status](VALIDATION.md) · [acceptance](ACCEPTANCE.md)

This project is not an official OpenAI or Obsidian plugin.
