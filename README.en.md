# Codex Daybook 0.5.8

Desktop Obsidian plugin that saves completed local **Codex Desktop** conversations as Markdown notes. An optional daily track can link them into a daily Dataview trail. Not a ChatGPT history importer: it only handles local Codex Desktop main tasks, and only tasks created after you start sync are ever captured.

Available in the Obsidian Community plugin directory. Source is at [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync), licensed under MIT. The listing has not been manually reviewed by Obsidian staff, and Windows hardware validation is still pending.

[Chinese guide](README.md) · [privacy](PRIVACY.md) · [changelog](CHANGELOG.md)

## Setup

Requires Obsidian 1.13.7+ and a local Codex Desktop installation. Dataview is only needed if you turn on the optional daily track feature.

1. Extract the installation ZIP into your vault's `.obsidian/plugins/`, keeping the `codex-daily-sync` folder.
2. Enable this plugin in Obsidian's community plugins settings (also enable Dataview if you plan to use daily track).
3. The settings panel has two tabs: **Basic settings** (notes folder, attachments folder, Codex executable — auto-detected by default with a one-click Scan — time zone, and check interval) and **Daily track**, off by default; turning it on is a single toggle that reveals the daily folder and template, both already with working defaults.
4. Acknowledge outside-vault access, click **Log in to Codex** to sign in with ChatGPT, then **Check connection** to verify the interface. If no verifiable main task exists yet, finish a test task in Codex first.
5. Once the check passes, click **Start sync**. This fixes the sync starting point — only Codex main tasks created afterward are captured.

If auto-detection of the Codex executable fails, select it manually — only choose an executable you trust, since it runs with your account's permissions. The interface supports Simplified Chinese and English, switchable from Language in settings; this only changes the interface text, never synced note content.

## What gets synced

Only completed-turn user messages, final answers, and formal plans are exported; tool calls, reasoning, system messages, and in-progress or failed turns are never exported. Local PNG/JPEG/GIF/WebP images attached by the user or produced by Codex image generation are copied into the vault and deduplicated by content; remote images are never downloaded. Each task freezes its own folders, time zone, and creation day, so later setting changes don't affect existing notes. Settled, unchanged conversations never rewrite notes; personal text outside the synced content is preserved. Archiving or deleting the source conversation never automatically removes local notes, images, or daily links.

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
