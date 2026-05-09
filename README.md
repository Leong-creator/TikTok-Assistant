# TikTok Content Pipeline MVP

Generate a local CapCut-ready asset package from a TikTok Shop script.

The MVP does not create a CapCut draft and does not depend on Dreamina-to-CapCut sync. It prepares a folder that a human editor can import into CapCut.

## Implementation Rules

This project is reuse-first. Before adding a new workaround, use existing mature capabilities: pipeline modules, provider adapters, `download-collector`, retry commands, `dreamina` CLI, `lark-cli`, enabled Codex plugins, and installed skills.

All browser work must use the Codex Chrome plugin only. ChatGPT image downloads should use plugin download/media APIs plus the existing download collector; do not switch to another browser automation path or build a duplicate downloader.

For ChatGPT web images, review the generated images in the page before downloading. Download only accepted images into the package; retry mismatched shots in the same conversation.

Generated assets are reviewed for TikTok hook strength as well as prompt match. Failures must produce reusable lessons in review logs or prompt presets so future scripts reuse what was learned.
For business hooks, a calm accurate scene can still fail if the reference-level lure is stronger. Opening beats should usually push visible money shock, cash rain, status contrast, or stunned reactions before quieter explanatory scenes.
Image prompts should not reserve blank subtitle space. Captions are added over the image in CapCut, so assets should stay full-frame and visually complete.

## Quick Start

Run tests:

```bash
npm test
```

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

`generate:top01:image-mvp` routes the first three key images to ChatGPT web `image-2` and the remaining stills to Dreamina. It requires a Codex browser adapter for ChatGPT web image generation; it must not fall back to OpenAI API or another ChatGPT image model. Dreamina prompts are Chinese-only and use `model_version=4.0` by default for free image tests.

For longer scripts, do not start with full generation. Use staged production:

```bash
node src/cli.mjs --script fixtures/qdhoaudq-43k-script.txt --slug qdhoaudq-calibration --mode calibration --provider image-mvp --image-only --story-category make_money --product-category raise_children
node src/cli.mjs --script fixtures/qdhoaudq-43k-script.txt --slug qdhoaudq-pilot --mode pilot --provider image-mvp --image-only --story-category make_money --product-category raise_children
```

Only after calibration and pilot pass should a script-specific full run be planned. Routing counts are per run, not global constants. The `qdhoaudq_43k` sample uses a business-story wrapper for a raise-children product:

```bash
npm run generate:qdhoaudq:mock
```

That run uses `--total-shots 80`, `--video-shots 24`, and `--chatgpt-image-count 30` only for this script. Other scripts must estimate their own counts from script length, pacing, product category, and visual complexity.

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
- ChatGPT web tasks reuse one conversation per script, start with 3-image batches, may grow to 5/10 only after stable output, and must move browser downloads into `03_key_images_chatgpt/`.
- Video generation is not part of this MVP test; video candidate shots are generated as first-frame images.
