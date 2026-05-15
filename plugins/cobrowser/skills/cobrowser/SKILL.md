---
name: cobrowser
description: Use CoBrowser when the user wants Codex to operate a real browser, open pages, inspect web content, click, type, scroll, take screenshots, download files, or verify browser behavior with a stable Playwright persistent Chrome session.
---

# CoBrowser

CoBrowser is the default browser operation layer for real website work. It uses Playwright persistent Chrome contexts with plugin-managed profiles. Do not use the Codex Chrome extension or in-app browser as a fallback for this skill.

## User Contract

The user should only need to specify the task and optionally `headed` or `headless`.

- If the user explicitly says `headed`, run CoBrowser in headed mode.
- If the user explicitly says `headless`, run CoBrowser in headless mode.
- If unspecified, choose headed for login, visual review, file downloads that need confirmation, or user-observed workflows.
- If unspecified, choose headless for page reading, extraction, checks, screenshots, and background automation.
- For manual login, use `login`, not `source`. `login` opens ordinary Chrome with CoBrowser's source profile and avoids Playwright automation flags that can trigger verification challenges.

Do not ask the user to provide profile, source profile, storage, safety, or timeout instructions. CoBrowser owns those defaults.

## Profile Model

CoBrowser owns the machine-wide browser source profile:

```text
~/.codex-cobrowser/source-profile
```

Use this source profile for manual login and shared login state. Do not make every automation task write directly to the source profile. Chrome user-data directories are single-writer resources; concurrent use can fail, corrupt state, or leak task context. For automation, use separate run profiles cloned from the source profile:

```text
~/.codex-cobrowser/run-profiles/<task-profile>
```

For project-specific persistent browser runtimes, prefer the CoBrowser source profile as the login source and keep separate run profiles for TikTok monitoring, ChatGPT, downloads, or other long-lived tasks. Use `node $CoBrowser paths` to print the canonical paths and recommended environment variables.

## Hard Rules

- Use only the CoBrowser scripts and runtime for CoBrowser browser tasks.
- Do not call the Codex Chrome plugin as a fallback.
- Do not read cookies, passwords, localStorage, sessionStorage, browser databases, or token stores.
- Do not operate pages the user did not request or that are not required for the current task.
- Do not mix project-specific collectors, TikTok logic, ChatGPT generation logic, or download-package logic into CoBrowser.
- Close the CoBrowser session when the task is finished.
- Let CoBrowser choose the run profile by default. It creates an isolated temporary run profile for each invocation and removes it after close.
- Use `--profile` only when the user explicitly asks to keep a named browser session across calls.

## Script Location

The local plugin script is:

```powershell
$CoBrowser = "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs"
```

## Commands

Run setup once when installing or diagnosing:

```powershell
node $CoBrowser setup
```

Print canonical profile paths and project environment variables:

```powershell
node $CoBrowser paths
```

Check the environment:

```powershell
node $CoBrowser doctor --launch true --mode headless
```

Open ordinary Chrome for manual login:

```powershell
node $CoBrowser login --url "https://chatgpt.com/"
```

After the user completes login, they should close that Chrome window before automated CoBrowser tasks run.

Open and snapshot a URL:

```powershell
node $CoBrowser open --mode headless --url "https://example.com"
```

Run browser actions from JSON:

```powershell
node $CoBrowser run --mode headed --url "https://example.com" --actions-file "actions.json"
```

Open the plugin-managed source profile through Playwright only for low-level diagnostics:

```powershell
node $CoBrowser source --mode headed --url "https://example.com" --keepOpenMs 300000
```

## Action JSON

Supported action types:

- `goto`: `{ "type": "goto", "url": "https://example.com" }`
- `snapshot`: `{ "type": "snapshot", "maxTextChars": 6000 }`
- `screenshot`: `{ "type": "screenshot", "fullPage": true }`
- `click`: `{ "type": "click", "selector": "button" }` or `{ "type": "click", "text": "Submit" }`
- `fill`: `{ "type": "fill", "selector": "input[name=q]", "value": "query" }`
- `press`: `{ "type": "press", "selector": "input[name=q]", "key": "Enter" }`
- `scroll`: `{ "type": "scroll", "y": 900 }`
- `wait`: `{ "type": "wait", "ms": 1000 }`
- `waitFor`: `{ "type": "waitFor", "selector": ".ready" }` or `{ "type": "waitFor", "text": "Ready" }`
- `text`: `{ "type": "text", "selector": "main" }`

For complex workflows, create a temporary ES module outside the plugin and run:

```powershell
node $CoBrowser task --mode headed --file "task.mjs"
```

The task module must export `async function run(session)`. Use `session.page`, `session.context`, and `session.paths`. Do not access browser storage.

## Output

All commands return JSON. Summarize the important result to the user instead of pasting large raw snapshots unless they ask for raw output.
