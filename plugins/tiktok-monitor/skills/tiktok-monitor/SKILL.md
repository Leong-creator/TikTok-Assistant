---
name: tiktok-monitor
description: Use when Codex should run the TikTok monitoring pipeline through CloakBrowser, inspect monitoring status, or remind the user about first-time monitor setup.
---

# TikTok monitor

Use this plugin when the task is:

- run one full TikTok monitor cycle
- inspect collection status
- run the approved append-only Base sync
- explain first-time setup requirements

This plugin is the **only formal execution path** for TikTok monitoring in this repository.
Do **not** re-create the flow by manually chaining `collect-cloakbrowser-batch`, `monitor-cycle`,
or ad hoc loops unless you are explicitly repairing the plugin implementation itself.

## Default commands

```powershell
node scripts/tiktok-monitor.mjs cycle
node scripts/tiktok-monitor.mjs cycle --background
node scripts/tiktok-monitor.mjs status
node scripts/tiktok-monitor.mjs sync
node scripts/tiktok-monitor.mjs setup
```

This plugin is installed as a local Codex plugin. The plugin page exposes the plugin metadata and this skill; the scripts under `scripts/` are the implementation layer behind those commands.

## First-time setup reminder

Before the first real collection:

1. Prefer `node scripts/install-local.mjs` on the target machine. The installer now auto-runs `setup.mjs` unless `--skip-setup` is used.
2. If setup still needs to be rerun manually, use `node scripts/setup.mjs`.
3. Let setup auto-create anything it can create:
   - bundled runtime
   - `monitoring_data/alert_config.json`
   - `monitoring_data/base_dashboard_whitelist_config.json`
   - `monitoring_data/base_dashboard_config.json`
4. If setup reports `还不能正式采集，请先完成以下步骤`, follow the Chinese manual actions exactly:
    - install/login CloakBrowser and TikTok
   - fill the real whitelist/base Feishu config values
5. Only start real collection after setup reports `可以正式采集`.

## Automatic readiness reminder

- This plugin now bundles a `SessionStart` hook.
- Codex officially supports plugin-bundled lifecycle hooks, but not a documented "open plugin page" event.
- So after the plugin is installed and the hook is trusted, starting or resuming a relevant TikTok monitor session can automatically warn when the environment is still not ready.
- The hook does not auto-run collection; it only performs a safe readiness check.

For portable distribution, the plugin can also be packaged with:

```powershell
node scripts/package-release.mjs
```

## Notes

- This plugin does not scrape cookies, passwords, or localStorage.
- This plugin is a wrapper around the repository monitor CLI; it does not replace the repository logic.
- The default cycle command follows the proven stable wrapper shape: first batch refreshes the plan, later batches stay on the same plan, and the run stops as soon as the current plan reaches completion.
- For Codex automations or any time-limited shell, use `cycle --background` so the plugin starts the same formal one-plan cycle in a detached local worker that can finish and sync after the automation shell exits.
- If the active `planCreatedAt` changes during a cycle, treat that as rollover and stop; do not silently keep collecting into a new plan.
- Do not use direct repository commands such as `monitor-cycle` or manual `collect-cloakbrowser-batch` loops as a normal operating path.
