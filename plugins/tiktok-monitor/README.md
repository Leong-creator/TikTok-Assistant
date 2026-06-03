# TikTok monitor

Portable local plugin for running TikTok monitoring with the stable `CloakBrowser` browser path.

## What shows up in the plugin page

Codex plugin pages primarily surface plugin metadata and skills, not raw script files. This plugin's user-facing entry is the `tiktok-monitor` skill plus the installed plugin metadata; the scripts in `scripts/` are the implementation behind that entry.

## What it does

- Can run from a bundled runtime
- Falls back to the repository source tree when the bundle is absent
- Defaults to `CloakBrowser` for real collection
- Uses a slow single-tab humanized collection profile by default
- Runs the full `collect -> analyze -> base-sync -> report` cycle by default
- Reminds the user about first-time setup

## First-time setup

Run:

```powershell
node scripts/setup.mjs
```

Checklist:

1. Build the bundled runtime with `node scripts/build-bundle.mjs`.
2. Install or copy the plugin to the target machine.
3. Ensure `CloakBrowser` is installed and its `source-profile` has logged in to TikTok.
4. Ensure `monitoring_data/alert_config.json` exists with your Feishu DM recipient.
5. Ensure `monitoring_data/base_dashboard_config.json` exists if Base sync is required.
6. Keep the TikTok source profile healthy. If the site starts returning login walls or blank profile lists, refresh the headed source-profile session before assuming the collector is broken.

For local installation:

```powershell
node scripts/install-local.mjs
```

For a distributable package:

```powershell
node scripts/package-release.mjs
```

That command builds:

- a ready-to-copy plugin folder
- a matching marketplace file
- an `install.ps1` one-click installer
- a zip package under `dist/plugin-releases/`

## Commands

```powershell
node scripts/tiktok-monitor.mjs cycle
node scripts/tiktok-monitor.mjs collect-batch
node scripts/tiktok-monitor.mjs status
node scripts/tiktok-monitor.mjs setup
```

Optional environment variables:

- `TIKTOK_MONITOR_REPO`
- `TIKTOK_MONITOR_DATA_DIR`
- `CLOAKBROWSER_HOME`

If the bundle is absent and `TIKTOK_MONITOR_REPO` is not set, the plugin tries:

- current working directory
- parent directories of current working directory
- sibling folders named `TikTok Project Monitor`

## Default command mapping

- `cycle` -> `node src/monitor-cli.mjs monitor-cycle --source cloakbrowser --max-tabs 1 --max-batch-iterations 120 --max-seed-videos 20 --max-accounts 1 --cloakbrowser-humanize true --cloakbrowser-human-preset careful`
- `collect-batch` -> `node src/monitor-cli.mjs collect-cloakbrowser-batch --max-tabs 1 --max-seed-videos 20 --max-accounts 1 --cloakbrowser-humanize true --cloakbrowser-human-preset careful`
- `status` -> `node src/monitor-cli.mjs collect-status`

## Publication / migration shape

- Keep this folder under version control as the canonical plugin source.
- Keep `../../.agents/plugins/marketplace.json` with the plugin so the repository carries its own local marketplace entry.
- Build the runtime bundle before distribution.
- Ship the built plugin folder plus the marketplace entry, or ship the generated release zip with `install.ps1`.
- On a new machine: install CloakBrowser, copy this plugin, log in once, configure Feishu files, then run `node scripts/tiktok-monitor.mjs cycle`.
