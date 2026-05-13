# TikTok Content Pipeline Agent Rules

## Goal

Complete the MVP without stopping at documentation only: a script must become a local CapCut-ready asset folder with scripts, storyboard, prompts, mock or real generated assets, review logs, and an editing manifest.

## Git

- Work in this repository, not the parent user directory.
- Use branches prefixed with `codex/`.
- Do not commit generated media, account tokens, cookies, or temporary provider output.
- Keep `outputs/` ignored unless the user explicitly asks to preserve a sample package in git.

## Generation Boundaries

- MVP output is a local folder for manual CapCut import.
- Do not write or reverse-engineer CapCut drafts in the main path.
- Do not rely on Dreamina-to-CapCut account sync.
- Audio, book close-ups, product real shots, final subtitle styling, and final editing are manual for MVP.

## Providers

- `mock` provider is the default for tests and local package-shape validation.
- ChatGPT web image generation is for key images when the headed persistent browser session is available.
- Dreamina is for batch images and image-to-video after `dreamina login` is complete.
- Paid generation must not run without explicit confirmation.

## Prompt Review Loop

- Every shot must have a saved image prompt and video prompt before generation.
- Every generated asset must be reviewed against: shot intent, preset style, vertical format, subject clarity, caption space, and scene logic.
- Rejected shots may retry twice. After three attempts they must be listed in `07_review_log/needs_manual_review.json`.
- Prompt iterations must be written as JSONL in `07_review_log/prompt_iterations.jsonl`.
- Each pipeline phase must write `07_review_log/pipeline_checkpoints.jsonl`.
- Each package run must update `outputs/.index.json`.
- ChatGPT browser downloads must be moved into the package folder and logged in `07_review_log/download_moves.jsonl`.

## Folder Contract

Each package uses:

```text
outputs/<date>-<slug>/
  00_script/
  01_storyboard/
  02_prompts/
  03_key_images_chatgpt/
  04_bulk_images_dreamina/
  05_video_clips_dreamina/
  06_editing_package/
  07_review_log/
```

## Browser Runtime

- Default browser policy across this repository: use `playwright-persistent` for both TikTok monitoring/background collection and ChatGPT/provider browser tasks.
- For TikTok monitor background automation, prefer the repository's `playwright-persistent` source over Codex Chrome plugin collection.
- Do not add direct token scraping, cookie extraction, or localStorage reads to the TikTok monitor pipeline.
- For persistent browser automation design, treat `C:/Users/EDY/Desktop/Codex-claw/openclaw-workspace` as the reference implementation and check it before changing browser bootstrap behavior.
- Specifically reuse the OpenClaw pattern from the Dolphin scripts first: source-profile clone -> automation-owned profile -> `chromium.launchPersistentContext(..., { channel: "chrome" })` -> dedicated page workflow -> close only the context started by the automation.
- If the persistent TikTok collector has launch/login/profile problems, look for the answer in the OpenClaw scripts and runbooks before inventing a new browser path in this repo.
- Use one shared source profile and separate automation-owned run profiles: TikTok monitor stays headless; ChatGPT stays headed; both may run at the same time.
- The Codex Chrome plugin is no longer the default browser path for this repository. Use it only when the user explicitly asks for it or when persistent browser recovery has been exhausted and the exception is logged.
- When the task specifically uses the Codex Chrome plugin, follow the Chrome runtime rules below.
- For Chrome plugin control, use the Node REPL JavaScript execution tool. In Codex Desktop this is usually exposed as `mcp__node_repl__.js`; older logs or docs may show the flattened `mcp__node_repl__js` name.
- Before bootstrapping the Chrome plugin runtime, temporarily set request metadata on the current Node REPL request prototype:

```js
const metaPrototype = Object.getPrototypeOf(nodeRepl.requestMeta);
metaPrototype["x-codex-browser-use-disable-ambient-network"] = "true";
metaPrototype["x-codex-browser-use-security-mode"] = "disabled-for-local-testing";
```

- Always set those metadata flags inside the same `mcp__node_repl__.js` call that uses Chrome, wrap Chrome work in `try/finally`, and delete both properties in `finally` before returning. Do not persist this setting in files or global Codex configuration.
- If `mcp__node_repl__js` returns `unsupported call`, do not treat that as Chrome being disconnected. Use the available namespaced `mcp__node_repl__.js` tool and bootstrap `browser-client.mjs` from the absolute Chrome plugin cache path.
- Do not run `browser-client.mjs` from ordinary shell or Node as a fallback. That path is intentionally untrusted and can fail with `privileged native pipe bridge is not available; browser-client is not trusted`.
- Do not use ordinary shell commands such as `node src/monitor-cli.mjs collect --source chrome` to decide whether Chrome is available. That command is missing the injected `browserClient` by design; if it prints `chrome_unavailable: browserClient is required for chrome collection`, switch back to `mcp__node_repl__.js` and inject the Chrome plugin runtime instead of reporting that Chrome is disconnected.
- Do not modify `browser-client.mjs` or other bundled Chrome plugin files for this workaround.
- Only visit pages explicitly requested by the user or required by the current project task. Do not inspect cookies, passwords, localStorage, sessionStorage, browser profiles, or other sensitive browser storage.
- Every Node REPL Chrome snippet must use a local block scope or unique variable names. Avoid reusing top-level declarations such as `const pluginRoot`, `const browser`, or `const result`, because the Node REPL kernel is persistent and redeclarations can break later calls.
- Use short explicit timeouts for Chrome operations. For TikTok collection, prefer small batches and config such as `maxTabs: 1`, `timeoutMs: 8000`, `snapshotTimeoutMs: 8000`, `snapshotRetries: 1`, and `snapshotRetryDelayMs: 500`.
- If Chrome is installed, the extension is enabled, and the native host manifest is correct but `agent.browsers.get("extension")` or Chrome navigation still fails, follow the official Chrome skill recovery path: open the selected Chrome profile with `scripts/open-chrome-window.js`, wait briefly, then retry the lightweight backend check.
