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
- ChatGPT web image generation is for key images when the Chrome plugin/browser login is available.
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
