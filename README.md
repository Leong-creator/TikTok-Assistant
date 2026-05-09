# TikTok Content Pipeline MVP

Generate a local CapCut-ready asset package from a TikTok Shop script.

The MVP does not create a CapCut draft and does not depend on Dreamina-to-CapCut sync. It prepares a folder that a human editor can import into CapCut.

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

The package is written to:

```text
outputs/<date>-<slug>/
```

## Output

Each package contains:

- `00_script/`: original and localized script draft.
- `01_storyboard/`: shot list.
- `02_prompts/`: generated image and video prompts.
- `03_key_images_chatgpt/`: key-image provider output or mock placeholders.
- `04_bulk_images_dreamina/`: bulk image provider output or mock placeholders.
- `05_video_clips_dreamina/`: image-to-video output or mock descriptors.
- `06_editing_package/`: CapCut import manifest and manual import guide.
- `07_review_log/`: prompt iteration log, contact sheet, visual review log, and manual review list.

## Real Provider Status

- Dreamina image generation uses the official `dreamina` CLI only.
- Dreamina image generation defaults to `model_version=4.0` for image MVP tests.
- Provider failures are logged per shot and do not stop the full package.
- ChatGPT key-image generation uses ChatGPT web `image-2` because ChatGPT Pro does not include API usage.
- Video generation is not part of this MVP test; video candidate shots are generated as first-frame images.
