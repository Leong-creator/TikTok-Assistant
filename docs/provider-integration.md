# Provider Integration

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

### `dreamina-image`

Dreamina image adapter:

1. Require `dreamina login`.
2. Check `dreamina user_credit`.
3. Submit batch text-to-image tasks with `dreamina text2image`.
4. Poll/download with `dreamina query_result`.
5. Save returned files and task metadata.

Default image model: `4.0`, because the user's account currently treats it as free in testing. The default provider prompt is Chinese-only and avoids English, numbers, shot labels, book-cover wording, comic-page wording, ad-layout wording, poster wording, speech bubbles, and interface wording because model `4.0` otherwise tends to draw visible text or multi-panel layouts into the image.

Observed quality note: Dreamina `4.0` is usable for low-cost bulk stills only after prompt cleanup. Earlier English/reference-style prompts produced panels and visible text. Wording such as "subtitle space" can also cause fake lower-third text. The stronger direction is Chinese-only, single-frame cinematic illustrated still, no text, clean negative space, no layout language.

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
