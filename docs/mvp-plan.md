# TikTok Content Production MVP

## Objective

Transform a TikTok Shop script into a local CapCut-ready asset folder. The MVP proves the workflow shape first, then provider adapters replace mock output with ChatGPT and Dreamina assets.

## MVP Flow

1. Read a script from a file or direct input.
2. Infer product category: `people_skill`, `raise_children`, `make_money`, or default.
3. Create localized script notes for the target language and region.
4. Build a test storyboard with 20 shots.
5. Mark the first 5 shots as video candidates and the remaining shots as still image candidates.
6. Generate image and video prompts from fixed presets.
7. Generate assets through the selected provider.
8. Review every asset and log prompt iterations.
9. Write editing manifests and manual CapCut import instructions.

## Implementation Principle

This project follows a reuse-first rule. Before adding a new script or workaround, use mature existing capabilities first: project pipeline modules, provider adapters, `download-collector`, retry commands, `dreamina` CLI, `lark-cli`, enabled Codex plugins, and installed skills. Browser tasks are restricted to the Codex Chrome plugin. If a mature capability fails, log the exact blocker and fix that path instead of silently switching to another browser or rebuilding a duplicate tool.

It also follows a learn-and-carry-forward rule. Every failed generation should improve the next run: record why the asset failed, capture the reusable lesson, and update prompt presets or review heuristics when the problem is systematic. Do not treat each script as a fresh prompt experiment with no memory.

The runtime lifecycle follows a Pixelle-inspired structure without importing Pixelle's Python stack:

```text
preparePackage -> buildStoryboard -> planPrompts -> generateAssets -> reviewAssets -> finalizePackage
```

Each phase writes `07_review_log/pipeline_checkpoints.jsonl`. The output root keeps `outputs/.index.json` so historical packages can be listed, retried, and traced back to provider status.

## Generation Modes

| Mode | Video shots | Image shots | Use |
| --- | ---: | ---: | --- |
| `test` | 5 | 15 | MVP validation and prompt checking |
| `standard` | 12 | 28 | Normal short production package |
| `full` | 24 | 56 | Future 3-6 minute package |

The mode values are defaults only. Long or short scripts can override `--total-shots`, `--video-shots`, and `--chatgpt-image-count` per run. Do not treat `80/24/30/50` as global limits; those are the current `qdhoaudq_43k` sample settings.

## Formal Image-Only Test

The first real-provider MVP run uses `fixtures/top01-reference-script.txt`, derived from the `top01_164k` reference video frames and visible subtitles.

- Provider: `image-mvp`.
- Key images: first 3 shots through ChatGPT web `image-2`.
- Bulk images: remaining shots through `dreamina text2image` with Chinese-only Dreamina prompts.
- Video candidates: keep `storyboardAssetType=video`, but generate image first frames only.
- No fallback is allowed for ChatGPT `image-2`.
- ChatGPT web generation should reuse one conversation per script and start with 3 images per batch; increase to 5 or 10 only after clean outputs.
- ChatGPT web images are reviewed in the conversation before download. Only accepted images are downloaded and collected.
- ChatGPT downloads must be moved from the browser download folder into `03_key_images_chatgpt/` and logged in `07_review_log/download_moves.jsonl`.
- ChatGPT downloads should use Chrome plugin download/media APIs first, then the existing download collector. Coordinate-click downloads are a last resort only after logging why semantic download controls were unavailable.
- Review includes TikTok hook strength, not only script match. For money/business hooks, calm lifestyle scenes usually underperform; use higher-impact visuals such as flying cash, rich/poor contrast, luxury status symbols, visible commissions, stunned coworkers, contracts, or before/after contrast.
- When reference material has a more attractive visual mechanic than the first generated result, treat that as a failed hook, not as a style preference. Record the lesson and push it back into the prompt preset or routing rule before the next run.
- Review semantic routing before accepting assets: a shared keyword such as `commission` must not collapse different events into the same real-estate office scene.
- Do not request bottom space or caption space from image providers. Subtitles are added over the frame in CapCut, so generated images should remain visually dense and complete from top to bottom.
- Dreamina generation uses CLI sessions and bounded concurrency, default `2`; timeout or rate-limit style failures lower the next real batch to `1`.
- Provider failures are retried per shot, logged, and do not stop the rest of the package.
- After generation, create a contact sheet and write visual issues into `07_review_log/needs_manual_review.json`.

## qdhoaudq 43k Sample

This sample is a two-layer script:

- `storyCategory=make_money`
- `productCategory=raise_children`
- `conversionAngle=use a money story to sell children real-world judgment and financial literacy`

For this script only, use:

```bash
npm run generate:qdhoaudq:mock
```

The mock run validates 80 shots, 24 future video first-frame candidates, 30 planned ChatGPT images, 50 planned Dreamina images, cleaned transcript output, and the final raise-children conversion section.

## Targeted Retry

After visual review, regenerate only failed shots instead of rerunning the whole package:

```bash
node src/cli.mjs --retry-package outputs/<date>-<slug> --shots S015,S016 --provider dreamina-image
```

The retry command updates `02_prompts/prompts.json`, `06_editing_package/editing_manifest.json`, `06_editing_package/editing_manifest.csv`, `07_review_log/prompt_iterations.jsonl`, `07_review_log/visual_review.jsonl`, and `07_review_log/needs_manual_review.json`.

Current special retry rules:

- `S015`: bright family living room, medium shot, no dark foreground blocks, no screen-like object.
- `S016`: conflict expressed by posture, distance, facial expression, and hand gesture, with no text-dependent concept.

## Manual Work Left For MVP

- Voiceover/audio.
- Book close-ups and product real shots.
- Final CapCut timeline, subtitles, keyword highlight styling, and CTA polish.

## Blockers Not Treated As MVP Failure

- Dreamina login not completed.
- ChatGPT Chrome/browser generation unavailable.
- Paid generation not approved.

In those cases, run the `mock` provider and keep provider-ready prompts and manifests.
