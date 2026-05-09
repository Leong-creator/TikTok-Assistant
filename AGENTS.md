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

## Reuse First

- Before adding scripts, browser workarounds, or provider glue, check and reuse the most mature existing capability available in this order: existing project modules, official CLIs, enabled Codex plugins, installed skills, and documented provider APIs.
- Do not rebuild features already covered by `dreamina` CLI, `lark-cli`, the Codex Chrome plugin, `download-collector`, provider queues, retry commands, manifest writers, or package index writers.
- For browser work, use only the Codex Chrome plugin. Do not use Playwright outside the Chrome plugin, system Chrome automation, in-app browser, or a newly built browser tool as a substitute.
- For ChatGPT image downloads, prefer Chrome plugin download/media APIs and then the existing download collector. Do not use coordinate-click download flows unless the plugin exposes no usable semantic/download control and the blocker is logged.
- Review ChatGPT web images in the page before downloading. Download only accepted images; retry visibly mismatched images in the same script conversation first.
- If an existing capability fails, diagnose and record the exact failure before changing approach. A fallback must preserve the same provider boundary and must not silently switch tools.

## Providers

- `mock` provider is the default for tests and local package-shape validation.
- ChatGPT web image generation is for key images when the Chrome plugin/browser login is available.
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
- ChatGPT batch generation may only batch prompts that already work as single-image prompts. Start with one image; if accepted, batch 2-3. Only grow to 5/10 after the page returns separate image outputs, not a storyboard page. If ChatGPT combines shots into a grid/panel page or answers with analysis, treat the prompt format as failed and return to single-image prompts or explicitly select the image tool in the Chrome plugin.
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
