# CoBrowser Install

CoBrowser is distributed as a local Codex plugin. The release package does not
include browser profile data, cookies, tokens, downloads, screenshots, or
machine-specific state.

## Requirements

- Codex Desktop with local plugin support.
- Node.js 20 or newer.
- Google Chrome installed.
- Network access if dependencies need to be installed.

## One-Command Install on Windows

Extract the release archive, open PowerShell in the extracted `cobrowser`
folder, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The installer copies the plugin to:

```text
%USERPROFILE%\plugins\cobrowser
```

It also adds or updates this entry in:

```text
%USERPROFILE%\.agents\plugins\marketplace.json
```

Restart Codex after installation so the plugin list refreshes.

## Verify

```powershell
$CoBrowser = "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs"
node $CoBrowser setup
node $CoBrowser doctor --launch true --mode headless
```

If Playwright is unavailable, run the installer again without `-SkipDependencies`,
or run this inside the installed plugin directory:

```powershell
npm install --omit=dev
```

## Login

For sites that need a browser login, open ordinary Chrome with CoBrowser's
source profile:

```powershell
node $CoBrowser login --url "https://chatgpt.com/"
```

Complete login in that Chrome window, close it, then use CoBrowser normally.
CoBrowser treats browser storage as opaque browser state and does not read
cookies, passwords, localStorage, sessionStorage, or token databases.

## Custom Locations

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -PluginParent "$env:USERPROFILE\plugins" `
  -MarketplacePath "$env:USERPROFILE\.agents\plugins\marketplace.json"
```

Use `-SkipDependencies` when Playwright is already resolvable by Node or when
installing offline.
