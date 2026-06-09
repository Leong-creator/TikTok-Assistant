# TikTok monitor

Portable local plugin for running TikTok monitoring with the stable `CloakBrowser` browser path.
It can be distributed as a GitHub release package and exposes a generic launcher command for non-Codex agents.

## Use It As A CLI

If you install this from GitHub, treat it as a **CLI first**.

- Preferred entry for any agent:
  - `tiktok-monitor setup`
  - `tiktok-monitor cycle`
  - `tiktok-monitor cycle --background`
  - `tiktok-monitor status`
  - `tiktok-monitor sync`
- Codex plugin usage is optional.
- The Codex plugin is only a thin wrapper around the same locked CLI path.

For GitHub installs, external agents should **not** depend on `plugin://tiktok-monitor`.
They should call the launcher command directly.

## Agent Quick Start

### 1. Install from GitHub release

- Windows:
  - run `install.cmd`
  - or run `install.ps1`
- macOS / Linux:
  - run `./install.sh`

### 2. Run readiness check

```powershell
tiktok-monitor setup
```

Expected Chinese status:

- `可以正式采集`
- `还不能正式采集，请先完成以下步骤`
- `初始化失败，请先修复关键问题`

### 3. Run collection

Foreground:

```powershell
tiktok-monitor cycle
```

Background:

```powershell
tiktok-monitor cycle --background
```

### 4. Inspect or sync only

```powershell
tiktok-monitor status
tiktok-monitor sync
```

### 5. Fallback if the launcher is unavailable

```powershell
node "$HOME/plugins/tiktok-monitor/scripts/tiktok-monitor-launcher.mjs" cycle
```

## What shows up in the plugin page

Codex plugin pages primarily surface plugin metadata and skills, not raw script files. This plugin's user-facing entry is the `tiktok-monitor` skill plus the installed plugin metadata; the scripts in `scripts/` are the implementation behind that entry.

## What it does

- Can run from a bundled runtime
- Falls back to the repository source tree when the bundle is absent
- Defaults to `CloakBrowser` for real collection
- Uses a slow single-tab humanized collection profile by default
- Locks the stable one-plan `cycle -> manual base sync` wrapper as the only formal execution path
- Reminds the user about first-time setup

## First-time setup

Run:

```powershell
node scripts/setup.mjs
```

If you install with:

```powershell
node scripts/install-local.mjs
```

the installer now auto-runs `setup.mjs` for you by default.

What setup now does automatically:

1. Creates `monitoring_data/` if it is missing.
2. Builds the bundled runtime when the source repo is available but `dist/runtime` is missing.
3. Creates `monitoring_data/alert_config.json` from the template if it is missing.
4. Creates `monitoring_data/base_dashboard_whitelist_config.json` from the template if it is missing.
5. Creates `monitoring_data/base_dashboard_config.json` from the template if it is missing.
5. Prints a final Chinese status:
   - `可以正式采集`
   - `还不能正式采集，请先完成以下步骤`
   - `初始化失败，请先修复关键问题`

Manual items that setup can only guide, not finish for you:

1. Install or copy the plugin to the target machine.
2. Install `CloakBrowser`.
3. Log in to TikTok once in the `source-profile`.
4. Fill in the real Feishu values inside:
   - `monitoring_data/alert_config.json`
   - `monitoring_data/base_dashboard_whitelist_config.json`
   - `monitoring_data/base_dashboard_config.json`
5. The whitelist config is the required one for the formal collection + append-only sync path; the larger dashboard config is optional unless you also need dashboard/schema workflows.
6. Keep the TikTok source profile healthy. If the site starts returning login walls or blank profile lists, refresh the headed source-profile session before assuming the collector is broken.

For local installation:

```powershell
node scripts/install-local.mjs
```

Optional:

```powershell
node scripts/install-local.mjs --skip-setup
```

For a distributable GitHub package:

```powershell
node scripts/package-release.mjs
```

That command builds:

- a ready-to-copy plugin folder
- a matching marketplace file
- `install.cmd` / `install.ps1` / `install.sh`
- a global launcher command entry: `tiktok-monitor`
- a zip package under `dist/plugin-releases/`

## Commands

Preferred generic launcher:

```powershell
tiktok-monitor setup
tiktok-monitor cycle
tiktok-monitor cycle --background
tiktok-monitor status
tiktok-monitor sync
```

Direct script fallback:

```powershell
node scripts/tiktok-monitor-launcher.mjs cycle
node scripts/tiktok-monitor-launcher.mjs cycle --background
node scripts/tiktok-monitor-launcher.mjs status
node scripts/tiktok-monitor-launcher.mjs sync
node scripts/tiktok-monitor-launcher.mjs setup
```

## What Agents Need To Prepare Manually

The installer and launcher try to encapsulate everything they safely can.
The remaining manual items are:

- install `Node.js`
- install `CloakBrowser`
- log in to TikTok once in the `source-profile`
- fill real Feishu Base / alert config values

If any of those are still missing, `tiktok-monitor setup` and `tiktok-monitor cycle` will stop and print Chinese guidance instead of silently failing.

Optional environment variables:

- `TIKTOK_MONITOR_REPO`
- `TIKTOK_MONITOR_DATA_DIR`
- `CLOAKBROWSER_HOME`

If the bundle is absent and `TIKTOK_MONITOR_REPO` is not set, the plugin tries:

- current working directory
- parent directories of current working directory
- sibling folders named `TikTok Project Monitor`

## Formal command contract

- `cycle`
  - foreground mode:
    - first batch refreshes the plan
    - subsequent batches stay on the same `planCreatedAt`
    - stop as soon as the current plan completes
    - then run exactly one `base-sync-manual`
  - `cycle --background`:
    - start the same formal one-plan cycle in a plugin-managed detached local worker
    - use this mode for Codex automations so shell timeouts do not truncate long runs
- `status`
  - reads the current plan and cursor plus managed background cycle state
- `sync`
  - runs the approved append-only `base-sync-manual`

Do not rebuild the flow with ad hoc `collect-cloakbrowser-batch` loops or `monitor-cycle`.

## Publication / migration shape

- Keep this folder under version control as the canonical plugin source.
- Keep `../../.agents/plugins/marketplace.json` with the plugin so the repository carries its own local marketplace entry.
- Build the runtime bundle before distribution.
- Ship the built plugin folder plus the marketplace entry, or ship the generated release zip with `install.cmd` / `install.ps1` / `install.sh`.
- For GitHub releases, the public-facing install story should be the CLI launcher, not the Codex plugin URI.
- On a new machine: install the package. The installer auto-runs `setup.mjs` when Node.js is available, creates launcher shims, and prints Chinese manual-action prompts for the remaining login/config steps. Then run `tiktok-monitor cycle`.

## Automatic checks after install

This plugin now bundles a `SessionStart` lifecycle hook.

- Official Codex hooks support plugin-bundled lifecycle hooks, including `SessionStart`.
- Official docs do **not** describe a dedicated "open plugin details page" event.
- So the practical behavior is:
  - install -> auto-run `setup.mjs`
  - later session startup in a relevant TikTok monitor workspace -> auto-run a safe readiness check hook

The bundled hook is non-invasive:

- it does **not** auto-edit config
- it does **not** auto-run collection
- it only warns in Chinese when the environment is still not ready

Plugin hooks still require trust review in Codex before they run.
