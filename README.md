# TikTok Content Pipeline MVP

Generate a local CapCut-ready asset package from a TikTok Shop script.

The MVP does not create a CapCut draft and does not depend on Dreamina-to-CapCut sync. It prepares a folder that a human editor can import into CapCut.

## Implementation Rules

This project is reuse-first. Before adding a new workaround, use existing mature capabilities: pipeline modules, provider adapters, `download-collector`, retry commands, `dreamina` CLI, `lark-cli`, enabled Codex plugins, and installed skills.

Browser defaults now use a shared OpenClaw-style persistent Chrome family: TikTok monitoring runs in a headless automation-owned profile, while ChatGPT image generation/review/download runs in a separate headed automation-owned profile. Both clone from the same shared source profile so they can stay logged in at the same time without sharing a live run profile.

Browser operations use the shared `persistent-browser-split-runtime-v1` policy: OpenClaw-style profile clone first, short DOM/media reads first, screenshots only as a fallback or handoff aid, and separate headed/headless run profiles so ChatGPT and TikTok tasks can run concurrently.

For ChatGPT web images, review the generated images in the page before downloading. Download only accepted images into the package; retry mismatched shots in the same conversation.

Generated assets are reviewed for TikTok 钩子 strength as well as prompt match. Failures must produce reusable lessons in review logs or prompt presets so future scripts reuse what was learned.
For business 钩子, a calm accurate scene can still fail if the reference-level lure is stronger. Opening beats should usually push visible money shock, cash rain, status contrast, or stunned reactions before quieter explanatory scenes.
If ChatGPT returns multiple independent images displayed as a grid of thumbnails, review them individually as batch output. If it returns one image that contains a multi-panel grid/storyboard, treat it as preview-only and regenerate accepted cells as standalone 9:16 images before Dreamina image-to-video.
Image prompts should not reserve blank subtitle space. Captions are added over the image in CapCut, so assets should stay full-frame and visually complete.

## Plugins

This repository also carries two local Codex plugin packages:

- `plugins/cobrowser`: stable Playwright-backed Chrome operation with plugin-managed profiles.
- `plugins/tiktok-monitor`: TikTok monitoring commands that use CoBrowser by default.

Install on another Windows computer by giving Codex or another AI agent this repository URL:

```text
https://github.com/Leong-creator/TikTok-Assistant
```

Then ask it to install the TikTok Assistant plugins. The AI should follow `INSTALL.md`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Leong-creator/TikTok-Assistant/main/scripts/install-plugins-from-github.ps1 | iex"
```

Manual release install links:

- CoBrowser: https://github.com/Leong-creator/TikTok-Assistant/releases/tag/cobrowser-v0.1.1
- TikTok monitor: https://github.com/Leong-creator/TikTok-Assistant/releases/tag/tiktok-monitor-v0.1.0

The local marketplace entry is `.agents/plugins/marketplace.json`. Release packages are generated into ignored `dist/` folders and should be attached to GitHub Releases rather than committed.

```bash
npm run plugin:cobrowser:package
npm run plugin:tiktok-monitor:build
npm run plugin:tiktok-monitor:package
```

## Codex Thread Routes

Long-running Codex conversations are mapped to dedicated branches/worktrees in `docs/thread-routing.md`. Use `scripts/route-thread.ps1` when reopening an old monitoring, content-production, or browser-runtime conversation.

## Quick Start

Run tests:

```bash
npm test
```

Current operator MVP:

Use the clean `TikTok素材制作助手` GPT in ChatGPT web:

```text
https://chatgpt.com/g/g-6a006f3961d48191a8c34af793cea88c-tiktoksu-cai-zhi-zuo-zhu-shou
```

Paste only the full script there, with no workflow prompt, technical instructions, or reminder text. The GPT treats a plain script paste as the formal production request, performs `首段钩子预检`, then first generates S001 as one clean standalone ChatGPT image in script order. The S001 image prompt sent to the image tool must not contain shot IDs, workflow text, or multi-shot context. After S001 passes review, later batch sizes are decided from the script and image complexity rather than fixed; if ChatGPT merges a batch into a collage or storyboard page, GPT falls back to a clean single-image retry. After operator confirmation it continues to full storyboard, remaining ChatGPT image generation, Dreamina image-to-video prompts, and prompt review. ChatGPT image generation happens inside the GPT conversation; only Dreamina image-to-video is copied and executed manually. The current MVP does not use the local App/MCP or GPT Action as the operator entry. The older GPT `g-6a002a6fc6948191b49ec2fde150ca83` was deleted and must not be recreated for production.

The local App / MCP server is retained only for developer packaging experiments:

```bash
npm run app:start
```

The MCP endpoint is `http://localhost:8787/mcp`. Do not connect it to the production GPT for the current MVP. The GPT operating guide is in `docs/tiktok-producer-gpt.md`.

Generate a test package with mock assets:

```bash
npm run generate:test
```

Generate the selected `top01_164k` reference sample with mock image-only assets:

```bash
npm run generate:top01:mock
```

Generate the same sample with Dreamina CLI images only:

```bash
npm run generate:top01:dreamina
```

Run the formal image MVP route:

```bash
npm run generate:top01:image-mvp
```

`generate:top01:image-mvp` routes the first three key images to ChatGPT web `image-2` and the remaining stills to Dreamina. ChatGPT image generation should run in the headed persistent browser session; it must not fall back to OpenAI API or another ChatGPT image model. Dreamina prompts are Chinese-only and use `model_version=4.0` by default for free image tests.

Open or check the headed ChatGPT browser session:

```bash
npm run chatgpt:browser
npm run chatgpt:browser:status
```

For longer scripts, do not start with full generation. Start with `首段钩子预检`: the first 30 seconds to 1 minute, with shot count decided from the script. ChatGPT generates and reviews first-frame images first; approved first frames are then copied manually into Dreamina image-to-video.

```bash
node src/cli.mjs --script fixtures/qdhoaudq-43k-script.txt --slug qdhoaudq-calibration --mode calibration --provider image-mvp --image-only --story-category make_money --product-category raise_children
node src/cli.mjs --script fixtures/qdhoaudq-43k-script.txt --slug qdhoaudq-pilot --mode pilot --provider image-mvp --image-only --story-category make_money --product-category raise_children
```

Only after the opening 钩子 direction passes should a script-specific full run be planned. Routing counts are per run, not global constants. The `qdhoaudq_43k` sample uses a business-story wrapper for a raise-children product:

```bash
npm run generate:qdhoaudq:mock
```

That run uses `--total-shots 80`, `--video-shots 24`, and `--chatgpt-image-count 30` only for this script. Other scripts must estimate their own counts from script length, pacing, product category, and visual complexity. The default MVP path makes ChatGPT the main image source and writes Dreamina image-to-video tasks for video shots.

Run Dreamina with an explicit session and controlled concurrency:

```bash
node src/cli.mjs --script fixtures/top01-reference-script.txt --slug top01-reference-dreamina --mode test --provider dreamina-image --image-only --dreamina-session top01-reference --dreamina-concurrency 2
```

Retry only selected shots after review:

```bash
node src/cli.mjs --retry-package outputs/<date>-<slug> --shots S015,S016 --provider dreamina-image
```

The package is written to:

```text
outputs/<date>-<slug>/
```

Every generated package is indexed in `outputs/.index.json`, and each package writes Pixelle-style lifecycle checkpoints to `07_review_log/pipeline_checkpoints.jsonl`.

## Output

Each package contains:

- `00_script/`: original and localized script draft.
- `01_storyboard/`: shot list.
- `02_prompts/`: generated image and video prompts.
- `03_key_images_chatgpt/`: key-image provider output or mock placeholders.
- `04_bulk_images_dreamina/`: bulk image provider output or mock placeholders.
- `05_video_clips_dreamina/`: image-to-video output or mock descriptors.
- `06_editing_package/`: CapCut import manifest and manual import guide.
- `07_review_log/`: prompt iteration log, lifecycle checkpoints, ChatGPT session/task metadata, download move log, visual review log, and manual review list.

## Real Provider Status

- Dreamina image generation uses the official `dreamina` CLI only.
- Dreamina image generation defaults to `model_version=4.0` for image MVP tests.
- Dreamina tasks can be grouped by `--dreamina-session` and run with bounded concurrency via `--dreamina-concurrency`; timeout or rate-limit style errors should drop the next real batch to concurrency `1`.
- Provider failures are logged per shot and do not stop the full package.
- ChatGPT key-image generation uses ChatGPT web `image-2` because ChatGPT Pro does not include API usage.
- ChatGPT web tasks reuse one conversation per script. Batch sizes are script-dependent: front first frames usually stay small, middle story images can expand when outputs are stable, and back conversion/book b-roll uses only as many images as the script needs.
- Dreamina image generation is fallback only for the first GPT-first MVP. Dreamina's primary manual task is image-to-video from approved ChatGPT first frames.
