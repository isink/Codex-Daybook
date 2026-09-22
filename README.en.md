# Codex Daybook 0.5.7 — local release candidate

Desktop Obsidian plugin. Source is public at [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync). **Windows hardware validation, community review, and a real community-channel installation remain pending. Licensed under MIT; a release candidate is not a marketplace listing.** See [Chinese guide](README.md), [privacy](PRIVACY.md), [test checklist](WINDOWS-CHECKLIST.md), and [validation status](VALIDATION.md).

## Setup

Requires Obsidian Desktop 1.13.7+, enabled Dataview, and a local Codex Desktop installation (ChatGPT sign-in is available from the plugin). The experimental App Server endpoints were checked against CLI `0.155.0-alpha.9.2`. Other versions must pass the compatibility check; do not automatically install or downgrade Codex.

1. Extract the installation ZIP into your vault's `.obsidian/plugins/`. Keep the `codex-daily-sync` folder containing `main.js`, `manifest.json`, `styles.css`, and dependency notices.
2. Enable Dataview and this plugin. First activation shows a notice directing you to settings: it does not spawn Codex or read conversations.
3. Configure the vault-relative note/attachment/daily folders, optional daily template, IANA time zone, and 5–3600-second interval (default 10). The three folder fields suggest existing vault folders as you type; you can still enter a new folder that does not exist yet. The daily-template field suggests Markdown notes in the vault, and **Choose template…** opens a searchable picker.
4. Acknowledge outside-vault access, then click **Log in to Codex**. The plugin detects local Codex, reuses an existing ChatGPT login or opens the official browser sign-in page. After login, click **Check connection**. This reads a small sample from one existing Codex Desktop task to verify source fields and paging, without importing it. If none exists, finish a test task in Codex first.
5. Click **Start sync**. This persists the fixed creation-time cutoff. Only future local Codex Desktop main tasks are discovered; the first completed turn creates a note. **Pause sync** pauses without resetting the cutoff. Saving settings pauses and requires another connection check.

The settings UI supports Simplified Chinese and English. Default folders are `Codex Conversations`, `Attachments/Codex`, and `Daily`. Initial time zone comes from the system and is then saved. The executable picker is collapsed under **Advanced**. macOS checks standard installations and PATH; Windows supports an explicitly selected real `codex.exe` or PATH lookup. No shell interpolation, `.cmd` execution, WSL, automatic installation, or PATH modification. Only select a trusted executable; it runs with your account's permissions.

## Behavior

This is not an ordinary ChatGPT history importer. Top-level app view names do not determine a task's source. Completed user messages, final answers and formal plans are exported; tools, reasoning, intermediate updates and unfinished/failed turns are excluded.

Question bubbles align right, answers remain normal left-aligned Markdown. Mapped local PNG/JPEG/GIF/WebP images are content-hashed and copied into the vault once, with proportional 240×180 previews. Clicking opens the original in a new tab. Missing originals reuse saved mappings; remote images are not downloaded. Personal text outside sync markers is preserved. Settled, unchanged tasks do not rewrite notes or images. Version 0.5.1 reconciles older records once, preserving their cutoff, paths and personal additions. Attachment caches are persisted separately; failed note writes remain pending until publication and final state persistence both succeed.

Each enrolled task freezes its output folders, time zone and creation day. Later setting changes affect newly enrolled tasks only. Existing filenames are not automatically renamed. Daily filenames are fixed as `YYYY-MM-DD.md`. The built-in template uses Dataview; custom templates substitute only `{{date:YYYY-MM-DD}}` and never execute scripts. Existing daily notes are untouched; copy the query from settings if needed. First publication stages a complete temporary file, renames it, and appends one trailing newline through Vault.process to trigger Markdown indexing; subsequent unchanged syncs do not write.

Archive, deletion or read failure never automatically removes local notes, daily links or images. Only successfully exported content is preserved. Connection errors are not deletion evidence. Reconnect manually after failures; disabling the plugin closes only its own child process and removes listeners/timers.

## Upgrade and development

Back up plugin files, `data.json`, notes and assets first. Version 0.4 migration retains mappings and cutoff, infers settings, and pauses for confirmation. Existing daily links and creation timestamps remain authoritative. Preserve `data.json`; deleting it loses tracking and the saved-image mappings needed after temporary originals disappear. See [rollback](CHANGELOG.md).

With Node.js 22.14+ or 24, run `npm ci`, `npm run package`, then `npm audit --audit-level=high`. Tests use fictional data. `npm run probe` explicitly checks the real local Codex connection and prints only pass/fail. The fixture server is for isolated UI QA and is excluded from installation packages. No runtime dependency installation, telemetry or conversation upload is performed by the plugin. Codex may use its own account services. The MIT project license and complete yaml runtime notice are embedded in main.js, including for community installations. See [acceptance](ACCEPTANCE.md) and [release process](RELEASE.md). The traditional settings panel currently does not expose fields to global settings search; this is a recorded lint recommendation, not a hidden error.

## Interface language

Choose **简体中文** or **English** in Settings → Codex Daybook → Language, then click **Save settings**. The settings panel, commands, status bar and notices use the saved language immediately. On first use or the first upgrade from a version without this setting, Chinese Obsidian locales select Simplified Chinese; other locales select English. Saving settings pauses sync; check the connection and start it again. The preference survives restart. Language changes do not translate task content or rewrite existing notes.

## Account sign-in

Codex app-server manages the official browser OAuth flow and stores credentials; the plugin never collects passwords or stores tokens in the vault. This login may be reused by other clients sharing the same Codex configuration directory. Browser login needs network access and a local Codex installation. Login alone never starts sync. Cancel login only cancels this attempt, without logging out an existing account. Pause, saving other settings or disabling the plugin closes its own login process. No global logout button is provided. See the [official login interface](https://developers.openai.com/zh-Hans/docs/app-server).
