# TikTok Content Pipeline Agent Rules

## Goal

Complete the MVP without stopping at documentation only: a script must become a local CapCut-ready asset folder with scripts, storyboard, prompts, mock or real generated assets, review logs, and an editing manifest.

## Git

- Work in this repository, not the parent user directory.
- Use branches prefixed with `codex/`.
- Do not commit generated media, account tokens, cookies, or temporary provider output.
- Keep `outputs/` ignored unless the user explicitly asks to preserve a sample package in git.

## Thread Routing

- If `CODEX_THREAD_ID` matches a known long-running project thread, continue in the corresponding branch/worktree before making edits. The source of truth is `docs/thread-routing.md`.
- `019e0c97-3cc0-7123-b12c-c0fb03202134` is TikTok monitoring and should use branch `codex/thread-tiktok-monitor`.
- `019e086a-4d18-7262-9ba3-0432468371c2` is content production / GPT image workflow and should use branch `codex/thread-content-production`.
- `019e0d06-45b2-70b1-9db4-42a5a885bcea` is CoBrowser / browser runtime and should use branch `codex/thread-browser-runtime`.
- If the current shell is in an old temporary worktree such as `TikTok Project Monitor` or `__tmp_*`, stop using that path for new edits. Run `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\EDY\Desktop\TikTok Project\scripts\route-thread.ps1"` and use the returned worktree path for subsequent commands.

## Generation Boundaries

- MVP output is a local folder for manual CapCut import.
- Do not write or reverse-engineer CapCut drafts in the main path.
- Do not rely on Dreamina-to-CapCut account sync.
- Audio, book close-ups, product real shots, final subtitle styling, and final editing are manual for MVP.

## Reuse First

- Before adding scripts, browser workarounds, or provider glue, check and reuse the most mature existing capability available in this order: existing project modules, official CLIs, enabled Codex plugins, installed skills, and documented provider APIs.
- Do not rebuild features already covered by `dreamina` CLI, `lark-cli`, `playwright-persistent` runtimes, `download-collector`, provider queues, retry commands, manifest writers, or package index writers.
- For TikTok monitor/background collection, use the repository's CoBrowser-backed formal command as the default browser path: `node src/monitor-cli.mjs monitor-cycle --source cobrowser --data-dir monitoring_data` in the assigned project worktree, or the portable wrapper `node C:/Users/EDY/plugins/tiktok-monitor/scripts/tiktok-monitor.mjs cycle`.
- That collector must follow the OpenClaw browser pattern from `C:/Users/EDY/Desktop/Codex-claw/openclaw-workspace`: source-profile clone -> automation-owned profile -> `chromium.launchPersistentContext(..., { channel: "chrome" })` -> dedicated page workflow -> close only the automation-owned context.
- For ChatGPT web image generation, review, and download in the content pipeline, use a headed `playwright-persistent` run profile that clones from the same shared source profile as TikTok monitoring.
- Do not introduce a third browser path unless both the persistent browser path and the explicit fallback path have been proven unsuitable for the task and the failure has been recorded.
- For ChatGPT image downloads, prefer the headed persistent browser session and then the existing download collector. Do not use coordinate-click download flows unless the direct visible download path is unavailable and the blocker is logged.
- Review ChatGPT web images in the page before downloading. Download only accepted images; retry visibly mismatched images in the same script conversation first.
- If an existing capability fails, diagnose and record the exact failure before changing approach. A fallback must preserve the same provider boundary and must not silently switch tools.

## Providers

- `mock` provider is the default for tests and local package-shape validation.
- ChatGPT web image generation is for key images when the headed persistent browser session is available.
- Dreamina is for batch images and image-to-video after `dreamina login` is complete.
- Paid generation must not run without explicit confirmation.

## Long Script Production Stages

- Long scripts must not start with full generation. Use staged production by default: `calibration` -> `pilot` -> script-specific `full`.
- `calibration` is a small style and routing check: 8 shots, 3 video first-frame candidates, and 4 ChatGPT-routed key images by default.
- `pilot` is a small production slice: 20 shots, 8 video first-frame candidates, and 8 ChatGPT-routed key images by default.
- `full` shot counts are not global. Estimate them per script from script length, pacing, product category, and visual complexity. The qdhoaudq sample's 80 shots / 24 video first frames / 30 ChatGPT images are only that sample's settings.
- After each stage, review failures and update prompt/routing rules before expanding. Do not continue to the next stage when calibration reveals provider mismatch, weak hook strength, bottom blank bands, or repeated multi-panel output.
- Route complex relationship, abstract business logic, hook, and conversion shots to ChatGPT web first. Route simple single-person, object, hotel, office, car, cash, contract, and atmosphere shots to Dreamina.

## Prompt Review Loop

- Every shot must have a saved image prompt and video prompt before generation.
- ChatGPT web image prompts must use the fixed image-generation contract: start with an explicit create/draw command, state one output unit, then provide structured fields for style, subject type, shot intent, composition/camera, character setup, action/relationship, micro-expression, background, lighting/dynamics, and negative constraints. Do not mix workflow instructions, review policy, or long script context into the image prompt sent to ChatGPT.
- Before sending any ChatGPT web image prompt, explicitly select the ChatGPT image-generation tool in the headed persistent ChatGPT session. Do not rely on plain chat mode to infer image generation from the prompt text.
- ChatGPT batch generation may only batch prompts that already work as single-image prompts. Start with one image; if accepted, batch 2-3. Only grow to 5/10 after the page returns separate image outputs, not a storyboard page. If ChatGPT combines shots into a grid/panel page or answers with analysis, treat the prompt format as failed and return to single-image prompts or explicitly reselect the image tool in the persistent session.
- For ChatGPT, shot labels such as `S004` may appear in the surrounding message text or manifest, but the image prompt itself must say that labels/text must not be drawn. Prefer "Image 1 / Image 2" for batch grouping rather than repeated shot IDs inside the creative body.
- Every generated asset must be reviewed against: shot intent, preset style, vertical format, subject clarity, full-frame composition, and scene logic.
- Review must also score TikTok hook strength: visual shock, conflict, curiosity gap, money/status contrast, emotional tension, and whether the image can stop scrolling in the first second.
- ChatGPT web images are reviewed in the page before download; accepted images are then downloaded and collected into the package.
- Rejected shots may retry twice. After three attempts they must be listed in `07_review_log/needs_manual_review.json`.
- Prompt iterations must be written as JSONL in `07_review_log/prompt_iterations.jsonl`.
- Every rejection must record the real reason and the reusable lesson. Update prompt presets, shot planning notes, or review heuristics when a failure reveals a pattern, so the next similar script does not restart from zero.
- For money/business hooks, prefer high-impact visuals such as flying cash, exaggerated status contrast, luxury objects, stunned reactions, commission checks, contracts, rich-person settings, or visible before/after contrast instead of calm lifestyle scenes.
- If the reference material has a stronger visual lure than the generated image, reject or retry even when the image technically matches the prompt. For this niche, cash-rain / flying-money / shocked-bystander frames usually beat calm hotel luxury for the opening beat.
- Do not let broad keywords override story meaning. For example, "commission" is not always real estate, "car" is not always a Ferrari showroom, and referral/family-negotiation scenes need their own visuals.
- Do not ask image providers to leave bottom space or caption space. Subtitles are added over the image later, so generated frames should stay full and visually dense from top to bottom.
- Each pipeline phase must write `07_review_log/pipeline_checkpoints.jsonl`.
- Each package run must update `outputs/.index.json`.
- ChatGPT browser downloads must be moved into the package folder and logged in `07_review_log/download_moves.jsonl`.
- Before collecting ChatGPT browser downloads, take a recursive `download-collector` snapshot of the full Downloads tree immediately before clicking download. Do not build a top-level-only snapshot, because the collector recursively scans subfolders.
- Shot counts, video first-frame counts, and ChatGPT/Dreamina routing counts are per-run decisions. Do not hard-code one sample's counts as global policy.
- When story category and product category differ, keep story visuals in the main narrative and reserve product visuals for conversion shots.

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

- Default browser policy across this repository: use CoBrowser-backed monitor commands for TikTok monitoring/background collection, and use `playwright-persistent` for ChatGPT/provider browser tasks.
- Treat `C:/Users/EDY/Desktop/Codex-claw/openclaw-workspace` as the reference implementation for persistent browser bootstrap, profile seeding, login reuse, and recovery behavior.
- Use one shared source profile and separate automation-owned run profiles: TikTok monitor stays headless; ChatGPT stays headed; both may run at the same time.
- Do not add direct token scraping, cookie extraction, or localStorage reads to the TikTok monitor pipeline or the ChatGPT content pipeline.
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
