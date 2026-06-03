---
name: tiktok-monitor
description: Use when Codex should run the TikTok monitoring pipeline through CloakBrowser, inspect monitoring status, or remind the user about first-time monitor setup.
---

# TikTok monitor

Use this plugin when the task is:

- run one full TikTok monitor cycle
- continue bounded CloakBrowser-backed collection
- inspect collection status
- explain first-time setup requirements

## Default commands

```powershell
node scripts/tiktok-monitor.mjs cycle
node scripts/tiktok-monitor.mjs collect-batch
node scripts/tiktok-monitor.mjs status
node scripts/tiktok-monitor.mjs setup
```

This plugin is installed as a local Codex plugin. The plugin page exposes the plugin metadata and this skill; the scripts under `scripts/` are the implementation layer behind those commands.

## First-time setup reminder

Before the first real collection:

1. Build the bundled runtime with `node scripts/build-bundle.mjs`, or verify the monitor repository root can be found or set `TIKTOK_MONITOR_REPO`.
2. Verify CloakBrowser is installed.
3. Open CloakBrowser login mode and log in to TikTok once so its `source-profile` contains a real session.
4. Ensure `monitoring_data/alert_config.json` exists.
5. Ensure `monitoring_data/base_dashboard_config.json` exists if Base sync is part of the workflow.

For portable distribution, the plugin can also be packaged with:

```powershell
node scripts/package-release.mjs
```

## Notes

- This plugin does not scrape cookies, passwords, or localStorage.
- This plugin is a wrapper around the repository monitor CLI; it does not replace the repository logic.
- The default cycle command uses `monitor-cycle --source cloakbrowser` with a single-tab humanized profile, larger video batches, and enough batch iterations to finish one full plan in normal conditions.
- The default collect-batch command uses the same CloakBrowser humanized settings but only advances one bounded batch.
