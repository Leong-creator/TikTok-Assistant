# TikTok monitor

Portable local plugin for running TikTok monitoring with the stable `CoBrowser` browser path.

## What it does

- Can run from a bundled runtime
- Falls back to the repository source tree when the bundle is absent
- Defaults to `CoBrowser` for real collection
- Reminds the user about first-time setup

## First-time setup

Run:

```powershell
node scripts/setup.mjs
```

Checklist:

1. Build the bundled runtime with `node scripts/build-bundle.mjs`.
2. Install or copy the plugin to the target machine.
3. Ensure `CoBrowser` is installed and its `source-profile` has logged in to TikTok.
4. Ensure `monitoring_data/alert_config.json` exists with your Feishu DM recipient.
5. Ensure `monitoring_data/base_dashboard_config.json` exists if Base sync is required.

For local installation:

```powershell
node scripts/build-bundle.mjs
node scripts/install-local.mjs
```

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
- `COBROWSER_ROOT_DIR`

If the bundle is absent and `TIKTOK_MONITOR_REPO` is not set, the plugin tries:

- current working directory
- parent directories of current working directory
- sibling folders named `TikTok Project Monitor`

## Default command mapping

- `cycle` -> `node src/monitor-cli.mjs monitor-cycle --source cobrowser`
- `collect-batch` -> `node src/monitor-cli.mjs collect-cobrowser-batch`
- `status` -> `node src/monitor-cli.mjs collect-status`

## Publication / migration shape

- Keep this folder under version control as the canonical plugin source.
- Keep `../../.agents/plugins/marketplace.json` with the plugin so the repository carries its own local marketplace entry.
- Build the runtime bundle before distribution.
- Ship the built plugin folder plus the marketplace entry.
- On a new machine: install CoBrowser, copy this plugin, log in once, configure Feishu files, then run `node scripts/tiktok-monitor.mjs cycle`.
