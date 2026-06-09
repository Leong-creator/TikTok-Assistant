# TikTok monitor Release Template

Use this release as a **CLI package first**.

## Install

- Windows:
  - run `install.cmd`
  - or run `install.ps1`
- macOS / Linux:
  - run `./install.sh`

## Agent Entry

Preferred commands:

```powershell
tiktok-monitor setup
tiktok-monitor cycle
tiktok-monitor cycle --background
tiktok-monitor status
tiktok-monitor sync
```

Fallback if the launcher is unavailable:

```powershell
node "$HOME/plugins/tiktok-monitor/scripts/tiktok-monitor-launcher.mjs" cycle
```

## What The Installer Handles

- installs the plugin files
- installs the bundled runtime
- creates launcher shims
- runs readiness/setup checks
- prints Chinese guidance when manual login or config is still missing

## What Still Needs Manual Completion

- install `Node.js`
- install `CloakBrowser`
- log in to TikTok once in the `source-profile`
- fill real Feishu Base / alert config values

## Expected Setup Output

- `可以正式采集`
- `还不能正式采集，请先完成以下步骤`
- `初始化失败，请先修复关键问题`

## Important

- Treat this as a local CLI, not only as a Codex plugin.
- External agents should call `tiktok-monitor ...` directly.
- Do not rebuild the flow with ad hoc `collect-cloakbrowser-batch` loops or `monitor-cycle`.
