# Install TikTok Assistant Plugins From GitHub

Repository URL:

```text
https://github.com/Leong-creator/TikTok-Assistant
```

## AI Install Contract

If a user gives an AI agent this repository URL and asks it to install the plugins, the agent should:

1. Confirm the target machine is Windows and has PowerShell, Node.js 20+, npm, Chrome, and Codex installed.
2. Run the installer script from the repository raw URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Leong-creator/TikTok-Assistant/main/scripts/install-plugins-from-github.ps1 | iex"
```

3. Restart Codex or refresh its plugin list.
4. Run CoBrowser diagnostics:

```powershell
node "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs" doctor --launch true --mode headless
```

5. For TikTok monitoring, open a headed CoBrowser login window once and log in to TikTok:

```powershell
node "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs" login --url "https://www.tiktok.com/"
```

6. Run TikTok monitor setup:

```powershell
node "$env:USERPROFILE\plugins\tiktok-monitor\scripts\setup.mjs"
```

## Manual Release Install

Install CoBrowser first:

```text
https://github.com/Leong-creator/TikTok-Assistant/releases/tag/cobrowser-v0.1.1
```

Download `cobrowser-0.1.1.zip`, extract it, open PowerShell in the extracted `cobrowser` folder, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Force
```

Then install TikTok monitor:

```text
https://github.com/Leong-creator/TikTok-Assistant/releases/tag/tiktok-monitor-v0.1.0
```

Download `tiktok-monitor-0.1.0.zip`, extract it, open PowerShell in the extracted package folder, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

## What Gets Installed

- CoBrowser: `%USERPROFILE%\plugins\cobrowser`
- TikTok monitor: `%USERPROFILE%\plugins\tiktok-monitor`
- Local plugin marketplace: `%USERPROFILE%\.agents\plugins\marketplace.json`
- TikTok monitor plugin cache: `%USERPROFILE%\.codex\plugins\cache\local-codex-plugins\tiktok-monitor\0.1.0`

CoBrowser stores browser profiles under `%USERPROFILE%\.codex-cobrowser`. TikTok monitor stores operational data wherever `TIKTOK_MONITOR_DATA_DIR` points, defaulting to `monitoring_data` when run inside a project.

## Notes For Other AI Agents

- Do not inspect cookies, passwords, localStorage, sessionStorage, browser databases, or token stores.
- Do not commit or upload browser profiles, `.runtime/`, `monitoring_data/`, `outputs/`, or generated release artifacts.
- TikTok monitor depends on CoBrowser. Install CoBrowser first.

