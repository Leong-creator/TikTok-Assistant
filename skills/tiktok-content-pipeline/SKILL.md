---
name: tiktok-content-pipeline
description: Use when preparing TikTok Shop content assets from a script for manual CapCut editing in this project.
---

# TikTok Content Pipeline

Use this skill when the user provides a TikTok Shop script and wants Codex to prepare AI-generated content assets for manual CapCut editing.

## Workflow

1. Confirm the script file or paste-in script.
2. Reuse mature project capabilities before adding new code: existing pipeline modules, provider adapters, `download-collector`, retry commands, `dreamina` CLI, `lark-cli`, and the Codex Chrome plugin.
3. Validate package shape with mock assets:
   ```bash
   npm run generate:top01:mock
   ```
4. For the formal image MVP, use ChatGPT web `image-2` for planned key shots and Dreamina CLI for remaining stills. Do not fall back to API or browser Dreamina.
5. Use Dreamina `model_version=4.0` for free image tests and keep Dreamina provider prompts Chinese-only.
6. Choose `--total-shots`, `--video-shots`, and `--chatgpt-image-count` per script. Do not reuse qdhoaudq's 80/24/30 counts as global defaults.
7. Reuse one ChatGPT conversation per script, use batch size 3 first, review images in the page before download, only grow to 5/10 after stable outputs, and move accepted browser downloads into the package folder.
8. Use Dreamina CLI sessions and bounded concurrency:
   ```bash
   node src/cli.mjs --script fixtures/top01-reference-script.txt --slug top01-reference-dreamina --mode test --provider dreamina-image --image-only --dreamina-session top01-reference --dreamina-concurrency 2
   ```
9. For dual-layer scripts, set both `--story-category` and `--product-category`; for example a money story selling a raise-children product must keep business visuals until the final conversion section.
10. Generate no videos in this phase; video storyboard shots become first-frame images.
11. Review hook strength, not just semantic match. Money/business openings should create scroll-stopping impact with cash, cash rain, status contrast, stunned reactions, luxury symbols, or visible stakes. If the reference material's lure is stronger than the generated image, retry even when the image matches the sentence.
12. Reject provider-created bottom blank bands. Do not ask for caption space; subtitles are added over the frame in CapCut.
13. Review the contact sheet and write visual issues into `07_review_log/needs_manual_review.json`.
14. Retry only failed shots instead of rerunning the whole package:
   ```bash
   node src/cli.mjs --retry-package outputs/<date>-<slug> --shots S015,S016 --provider dreamina-image
   ```
15. Import assets into CapCut manually using `06_editing_package/editing_manifest.csv`.

## Provider Safety

- Use `mock` for validation.
- Do not run paid Dreamina generation without explicit confirmation.
- Dreamina prompt wording must avoid English, numbers, shot labels, subtitle wording, cover/poster/comic-page wording, speech bubbles, and interface language.
- Provider failures must be logged and must not stop the rest of the package.
- Keep task IDs, prompts, and review results in the output folder.
- Keep `outputs/.index.json` and each package's `07_review_log/pipeline_checkpoints.jsonl` updated.
- Do not leave ChatGPT downloads in the system Downloads folder after collection.
- Browser tasks must use only the Codex Chrome plugin. Do not substitute system Chrome automation, in-app browser, standalone Playwright, or a custom browser tool.
- ChatGPT image downloads should use Chrome plugin download/media APIs plus the existing `download-collector`; coordinate-click flows are last resort only after logging why semantic download controls failed.
- ChatGPT generated images should be visually reviewed in the web conversation before download. Reject and retry style-mismatched images in the same conversation instead of collecting them.
- Rejections must become reusable learning: record the failure reason, update prompt presets or review heuristics when the issue is systematic, and reuse those lessons in future scripts.
- Broad keywords must not override meaning. Distinguish real-estate commission, luxury-car commission, referral kickbacks, and family price negotiation before accepting generated assets.
