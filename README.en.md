# Codex Daybook 0.5.12

0.5.12 adds local WorkBuddy conversation import, including images attached to questions, and includes the 0.5.11 saving-quality fixes.

Desktop Obsidian plugin that saves completed local **Codex Desktop** conversations as Markdown notes, with optional import of local **WorkBuddy** conversations. An optional daily track can link them into a daily Dataview trail. It is not a ChatGPT history importer: Codex sync handles local Desktop main tasks, and only tasks created after you start sync are captured.

Available in the Obsidian Community plugin directory. Source is at [isink/Codex-Daybook](https://github.com/isink/Codex-Daybook), licensed under MIT. The listing has not been manually reviewed by Obsidian staff, and Windows hardware validation is still pending.

[Chinese guide](README.md) · [privacy](PRIVACY.md) · [changelog](CHANGELOG.md)

## Setup

Requires Obsidian 1.13.7+ and a local Codex Desktop installation. Dataview is only needed if you turn on the optional daily track feature.

On Windows, Codex Desktop from the Microsoft Store does not let other apps start its bundled Codex, so also install the Codex command-line tool: `npm install -g @openai/codex`. It reads the same conversation data as the desktop app.

1. Extract the installation ZIP into your vault's `.obsidian/plugins/`, keeping the `codex-daily-sync` folder.
2. Enable this plugin in Obsidian's community plugins settings (also enable Dataview if you plan to use daily track).
3. The settings panel has three tabs: **Basic settings** (notes folder, attachments folder, Codex executable — auto-detected by default with a one-click Scan — time zone, and check interval), **Daily track**, and **WorkBuddy**. Daily track and WorkBuddy are off by default.
4. Acknowledge outside-vault access, click **Log in to Codex** to sign in with ChatGPT (Codex's official browser sign-in; passwords and tokens never pass through the plugin or get written to the vault), then **Check connection** to verify the interface. If no verifiable main task exists yet, finish a test task in Codex first.
5. Once the check passes, click **Start sync**. This fixes the sync starting point — only Codex main tasks created afterward are captured.

If auto-detection of the Codex executable fails, select it manually — only choose an executable you trust, since it runs with your account's permissions. The interface supports Simplified Chinese and English, switchable from Language in settings; this only changes the interface text, never synced note content.

## What gets synced

Only completed-turn user messages, final answers, and formal plans are exported. If a completed turn has no explicitly marked final answer, the last nonempty assistant message with no phase is retained as a compatibility answer; tool calls, reasoning, system messages, and in-progress or failed turns are never exported. Local PNG/JPEG/GIF/WebP images attached by the user or produced by Codex image generation are copied into the vault and deduplicated by content; remote images are never downloaded. Each task freezes its own folders, time zone, and creation day, so later setting changes don't affect existing notes. Settled, unchanged conversations never rewrite notes; personal text outside the synced content is preserved. Archiving or deleting the source conversation never automatically removes local notes, images, or daily links. Upgrading to 0.5.11 performs one full reconciliation of enrolled conversations to recover previously omitted answers. Image-link conversion and attachment-path relocation preserve fenced and inline code examples.

## Local WorkBuddy conversations (experimental)

In the **WorkBuddy** tab, allow local data access, click **Check local data**, then **Start WorkBuddy sync**. The default source is `~/.workbuddy/projects`; enter an absolute path only if WorkBuddy stores its data elsewhere. Notes go to `WorkBuddy Conversations` in the vault by default. WorkBuddy and Codex sync can run independently. Checking local data does not pause an active sync. The first run imports existing local conversations; subsequent checks use the interval in Basic settings.

This importer was developed and verified against local ordinary-task JSONL files from WorkBuddy 5.6.2 on macOS, and rechecked on 5.7.7. It needs no WorkBuddy account token or cloud API. It saves only visible user questions and completed replies, excluding private context, reasoning, tool events, and unfinished turns. Images attached to a question are copied into the vault under `Attachments/WorkBuddy/<note name>/` (configurable in the WorkBuddy tab), deduplicated by content and shown inline; only WorkBuddy's own copies under `~/.workbuddy/blobs` are read, and a missing original keeps a placeholder with its file name. Other attachments get a not-imported placeholder; cloud-only tasks and other WorkBuddy product variants are unsupported. The local format has no stability guarantee: an incompatible conversation is skipped while existing notes remain. Personal metadata and text outside the sync markers are preserved, and pausing sync keeps local notes.

## Development

```sh
npm ci
npm run package
```

This project is not an official OpenAI or Obsidian plugin.
