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

## Generation Modes

| Mode | Video shots | Image shots | Use |
| --- | ---: | ---: | --- |
| `test` | 5 | 15 | MVP validation and prompt checking |
| `standard` | 12 | 28 | Normal short production package |
| `full` | 24 | 56 | Future 3-6 minute package |

## Formal Image-Only Test

The first real-provider MVP run uses `fixtures/top01-reference-script.txt`, derived from the `top01_164k` reference video frames and visible subtitles.

- Provider: `image-mvp`.
- Key images: first 3 shots through ChatGPT web `image-2`.
- Bulk images: remaining shots through `dreamina text2image` with Chinese-only Dreamina prompts.
- Video candidates: keep `storyboardAssetType=video`, but generate image first frames only.
- No fallback is allowed for ChatGPT `image-2`.
- Provider failures are retried per shot, logged, and do not stop the rest of the package.
- After generation, create a contact sheet and write visual issues into `07_review_log/needs_manual_review.json`.

## Manual Work Left For MVP

- Voiceover/audio.
- Book close-ups and product real shots.
- Final CapCut timeline, subtitles, keyword highlight styling, and CTA polish.

## Blockers Not Treated As MVP Failure

- Dreamina login not completed.
- ChatGPT Chrome/browser generation unavailable.
- Paid generation not approved.

In those cases, run the `mock` provider and keep provider-ready prompts and manifests.
