# TikTok Content Production MVP

## Objective

Validate the operator workflow in the `TikTok素材制作助手` GPT before relying on local packaging automation. In the current operator MVP, ChatGPT performs script understanding, 首段钩子预检, storyboard planning, ChatGPT image generation, Dreamina image-to-video prompts, and prompt review directly in the GPT conversation.

The existing local CapCut-ready package pipeline remains a developer track for testing package shape and future automation. It is not the production entry for this MVP.

## MVP Flow

1. Operator opens the `TikTok素材制作助手` GPT in ChatGPT web.
2. Operator pastes only the full script into the GPT conversation, with no workflow prompt, technical instructions, provider rules, or reminder text.
3. GPT infers language, story structure, front/middle/back segment roles, and whether Chinese localization is needed.
4. GPT runs `首段钩子预检` first: the first 30 seconds to 1 minute, with key-shot count decided from script speed, conflict density, and visual complexity.
5. GPT outputs Chinese 钩子判断, video first-frame storyboard, ChatGPT image prompts, and Dreamina image-to-video prompts.
6. After the 首段钩子 self-review passes, GPT must immediately run ChatGPT image generation in the same conversation. New scripts start by generating S001 as one clean standalone image in script order; the image-tool prompt must not contain shot IDs, workflow text, or multi-shot context. After S001 passes review, GPT chooses later batch sizes from opening pacing, visual complexity, style stability, and whether the image tool is returning separate outputs.
7. If any generation returns a collage, storyboard page, panel grid, or images with visible text, GPT records the failure and retries with a shorter clean single-image prompt. If a batch returns separate acceptable outputs, GPT can keep using script-dependent small batches.
8. Operator reviews only two decisions: whether the 首段钩子方向 and generated first-frame images pass, and whether to continue full production.
9. After confirmation, GPT expands to full storyboard, segment-specific image batches, Dreamina video prompts, naming guidance, and prompt复盘.
10. Operators manually copy approved ChatGPT first frames plus prompts into Dreamina image-to-video. ChatGPT image generation is not a separate manual provider step.
11. Local App/MCP, GPT Action, Codex, and package creation are not part of this operator MVP.

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
| `calibration` | 8 | 4 | 首段钩子预检 package; validates front first frames and Dreamina video prompts |
| `pilot` | 12 | 16 | Small production slice after the opening 钩子 passes |
| `test` | 8 | 12 | MVP validation and prompt checking |
| `standard` | 14 | 26 | Normal short production package |
| `full` | 24 | 56 | Future 3-6 minute package |

The mode values are defaults only. Long or short scripts can override `--total-shots`, `--video-shots`, and `--chatgpt-image-count` per run. Do not treat `80/24/30/50` as global limits; those are only the current `qdhoaudq_43k` sample settings.

Long scripts follow this fixed process:

1. `calibration`: 12-shot 首段钩子预检. It prioritizes the first 30 seconds to 1 minute and writes ChatGPT first-frame prompts plus Dreamina image-to-video prompts.
2. `pilot`: 28-shot production slice after the opening 钩子 passes. Expand only the validated style and provider routes.
3. `full`: script-specific full package. Estimate shot count from script length and editing rhythm; do not reuse another script's count.

Provider routing is staged too. Use GPT/ChatGPT to interpret the shot first, then either generate directly in ChatGPT for complex shots or compile a short Chinese Dreamina prompt for simple shots. Dreamina should receive visual instructions, not raw script logic.

## Formal Image-Only Test

The first real-provider MVP run uses `fixtures/top01-reference-script.txt`, derived from the `top01_164k` reference video frames and visible subtitles.

- Provider: `image-mvp`.
- Primary images: ChatGPT web `image-2`.
- Dreamina still images: fallback only.
- Video candidates: keep `storyboardAssetType=video`, generate ChatGPT first frames, then manually use Dreamina image-to-video prompts.
- No fallback is allowed for ChatGPT `image-2`.
- ChatGPT web generation should reuse one conversation per script. Batch sizes are script-dependent: front first frames start small and expand only after separate outputs are stable; middle and back sections use counts estimated from script pacing, visual complexity, and production need.
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

The mock run validates 80 shots, 24 future video first-frame candidates, planned ChatGPT images, optional Dreamina still-image fallback, Dreamina image-to-video task prompts, cleaned transcript output, and the final raise-children conversion section.

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
