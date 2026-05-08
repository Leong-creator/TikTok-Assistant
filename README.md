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
- `07_review_log/`: prompt iteration log and manual review list.

## Real Provider Status

- Chrome extension backend is available and can see existing Chrome tabs.
- Dreamina CLI is installed, but real generation must wait until `dreamina login` succeeds.
- Paid Dreamina generation is not run by default.
