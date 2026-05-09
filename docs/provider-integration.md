# Provider Integration

## Reuse-First Provider Rule

Provider work must reuse mature, already available capabilities before adding new glue. Use `dreamina` CLI for Dreamina, `lark-cli` for Feishu, the Codex Chrome plugin for ChatGPT web, the existing provider queues for concurrency, and `download-collector` for browser download归档. Do not replace a provider path with another browser, API, or custom downloader unless the requested provider path is truly blocked and the blocker is logged.

## Current Providers

### `mock`

Creates SVG placeholders and mock video descriptors. This is used for tests and package-shape validation.

### `chatgpt-web-image2`

Key-image adapter:

1. Use Codex Chrome extension backend when ChatGPT is already logged in.
2. Select/use ChatGPT web `image-2` only.
3. Submit only the selected key-image prompts.
4. Save generated assets into `03_key_images_chatgpt/`.
5. Run the same review loop and prompt iteration log.

No fallback is allowed for this provider. If `image-2` is not available or the page refuses generation, record a blocker instead of using OpenAI API, Codex image generation, or another ChatGPT image model.

Download handling must prefer the Chrome plugin's semantic download/media APIs and then `download-collector`. Coordinate-based downloading is a last resort only after logging that semantic download controls are not exposed.

Visual review happens before download: inspect generated ChatGPT images in the web conversation first, retry style-mismatched shots in the same script conversation, and download only accepted images.
For opening business shots, visual review must compare attraction strength with the reference material. A correct but quiet hotel scene should be rejected when the reference uses cash rain or stronger money-status shock.

Observed ChatGPT web save path: click the accepted generated image to open the preview layer, click the preview `保存` control, then choose the `下载图片` menu item. After the file lands in Downloads, run `download-collector` and reconcile the moved file into `editing_manifest.json` / `editing_manifest.csv`.

### `dreamina-image`

Dreamina image adapter:

1. Require `dreamina login`.
2. Check `dreamina user_credit`.
3. Submit batch text-to-image tasks with `dreamina text2image`.
4. Poll/download with `dreamina query_result`.
5. Save returned files and task metadata.

Default image model: `4.0`, because the user's account currently treats it as free in testing. The default provider prompt is Chinese-only and avoids English, numbers, shot labels, book-cover wording, comic-page wording, ad-layout wording, poster wording, speech bubbles, and interface wording because model `4.0` otherwise tends to draw visible text or multi-panel layouts into the image.

Observed quality note: Dreamina `4.0` is usable for low-cost bulk stills only after prompt cleanup. Earlier English/reference-style prompts produced panels and visible text. Wording such as "subtitle space" can also cause fake lower-third text or empty bottom bands. The stronger direction is Chinese-only, single-frame cinematic illustrated still, no text, full-frame composition, no layout language, and no requested caption area.

This MVP does not run `dreamina image2video`.

### `image-mvp`

Formal image-only MVP route:

- First three key shots: `chatgpt-web-image2`.
- Remaining shots: `dreamina-image`.
- Existing video candidate shots remain video candidates in the storyboard, but this run generates first-frame images only.
- The editing manifest records both `assetType` and `storyboardAssetType`.

## Dreamina Local Status

The CLI supports:

- `text2image` model versions `3.0`, `3.1`, `4.0`, `4.1`, `4.5`, `4.6`, `5.0`.
- `text2image` ratio `9:16`.
- `image2video` models including `3.0`, `3.0fast`, `3.0pro`, `3.5pro`, and `seedance2.0` families.

Use `dreamina <subcommand> -h` before running paid tasks because model support can change.

Current local setup:

- `dreamina.exe` is installed in the user's `bin` directory.
- `dreamina -h`, `dreamina text2image -h`, and `dreamina image2video -h` are available.
- `dreamina user_credit` requires completion of `dreamina login`.
