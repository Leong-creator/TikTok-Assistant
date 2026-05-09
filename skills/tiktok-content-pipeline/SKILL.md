---
name: tiktok-content-pipeline
description: Use when preparing TikTok Shop content assets from a script for manual CapCut editing in this project.
---

# TikTok Content Pipeline

Use this skill when the user provides a TikTok Shop script and wants Codex to prepare AI-generated content assets for manual CapCut editing.

## Workflow

1. Confirm the script file or paste-in script.
2. Validate package shape with mock assets:
   ```bash
   npm run generate:top01:mock
   ```
3. For the formal image MVP, use ChatGPT web `image-2` for the first three key shots and Dreamina CLI for remaining stills. Do not fall back to API or browser Dreamina.
4. Use Dreamina `model_version=4.0` for free image tests and keep Dreamina provider prompts Chinese-only.
5. Reuse one ChatGPT conversation per script, use batch size 3 first, only grow to 5/10 after stable outputs, and move all browser downloads into the package folder.
6. Use Dreamina CLI sessions and bounded concurrency:
   ```bash
   node src/cli.mjs --script fixtures/top01-reference-script.txt --slug top01-reference-dreamina --mode test --provider dreamina-image --image-only --dreamina-session top01-reference --dreamina-concurrency 2
   ```
7. Generate no videos in this phase; video storyboard shots become first-frame images.
8. Review the contact sheet and write visual issues into `07_review_log/needs_manual_review.json`.
9. Retry only failed shots instead of rerunning the whole package:
   ```bash
   node src/cli.mjs --retry-package outputs/<date>-<slug> --shots S015,S016 --provider dreamina-image
   ```
10. Import assets into CapCut manually using `06_editing_package/editing_manifest.csv`.

## Provider Safety

- Use `mock` for validation.
- Do not run paid Dreamina generation without explicit confirmation.
- Dreamina prompt wording must avoid English, numbers, shot labels, subtitle wording, cover/poster/comic-page wording, speech bubbles, and interface language.
- Provider failures must be logged and must not stop the rest of the package.
- Keep task IDs, prompts, and review results in the output folder.
- Keep `outputs/.index.json` and each package's `07_review_log/pipeline_checkpoints.jsonl` updated.
- Do not leave ChatGPT downloads in the system Downloads folder after collection.
