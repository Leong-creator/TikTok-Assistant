# CoBrowser

CoBrowser is a local Codex plugin for stable browser operation. It uses Playwright persistent Chrome contexts and plugin-managed profiles. It does not use the Codex Chrome extension.

## Install From Release

Extract the release archive, open PowerShell in the extracted `cobrowser` folder, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Restart Codex after installation. For upgrades over an existing local install, add `-Force`.
See `INSTALL.md` for dependency and marketplace details.

## Commands

```powershell
$CoBrowser = "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs"

node $CoBrowser setup
node $CoBrowser paths
node $CoBrowser login --url "https://chatgpt.com/"
node $CoBrowser doctor --launch true --mode headless
node $CoBrowser smoke-test --mode headed
node $CoBrowser open --mode headless --url "https://example.com"
node $CoBrowser run --mode headed --url "https://example.com" --actions-file "actions.json"
```

## Profile Model

CoBrowser stores its own state under `~/.codex-cobrowser` by default.

Use one machine-wide source profile for login state:

```text
~/.codex-cobrowser/source-profile
```

Individual automation tasks should not all write that same profile directly. Chrome locks user-data directories, and concurrent automation against one writable profile can corrupt state or leak task context between workflows. CoBrowser therefore clones the source profile into separate run profiles:

```text
~/.codex-cobrowser/run-profiles/<task-profile>
```

This gives one-login behavior while preserving task isolation. Each ordinary invocation uses an isolated temporary run profile and removes it after the browser session closes. If a named browser session is needed, pass `--profile <name>`.

To inspect the canonical paths and environment variables for other projects:

```powershell
node $CoBrowser paths
```

For manual login, open ordinary Chrome with the plugin-managed source profile:

```powershell
node $CoBrowser login --url "https://example.com"
```

Complete login in the opened Chrome window, then close that window before running automated CoBrowser tasks.

CoBrowser treats browser storage as opaque browser-owned state. It does not read cookies, passwords, localStorage, sessionStorage, token stores, or browser databases.

## Build Release Package

```powershell
npm run package
```

Release artifacts are written to `dist/`. The package excludes local browser
state under `~/.codex-cobrowser`, `node_modules`, and previous `dist` output.
See `PUBLISH.md` for the release checklist.
