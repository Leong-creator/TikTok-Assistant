# Provider Integration

## Reuse-First Provider Rule

Provider work must reuse mature, already available capabilities before adding new glue. Use `dreamina` CLI for Dreamina, `lark-cli` for Feishu, the Codex Chrome plugin for ChatGPT web, the existing provider queues for concurrency, and `download-collector` for browser download归档. Do not replace a provider path with another browser, API, or custom downloader unless the requested provider path is truly blocked and the blocker is logged.

## Current Providers

## Chrome Plugin Recovery

When `@chrome` reports `browser-client is not trusted` or the bridge looks disconnected while Chrome, the extension, and the native host are installed, run:

```bash
npm run chrome:ready
```

This follows the previously verified recovery path for this Windows setup: it clears stale Codex Chrome `extension-host.exe` processes under the bundled Chrome plugin cache, restores the `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.openai.codexextension` manifest pointer when needed, then runs the official Chrome plugin health checks. Do not switch to another browser or image provider for ChatGPT web work unless the Chrome plugin remains unavailable after this recovery.

Chrome browser operations use the shared `codex-chrome-short-step-dom-first-v1` policy now written into `chatgpt_session.json`, each `chatgpt_web_tasks/*.json`, `provider_task_manifest.json`, App run logs, and `npm run chrome:ready` output. The policy keeps the official Codex Chrome plugin path, but changes execution style:

- Prefer short DOM snapshots, targeted element attributes, and image/media metadata before screenshots.
- Avoid full-page screenshots and long one-shot polling loops on image-heavy ChatGPT conversations.
- Keep each browser action under about 15 seconds and each polling window under about 30 seconds; after a timeout, run `npm run chrome:ready` before continuing.
- Prefer Chrome plugin semantic download/media APIs, then the recursive `download-collector`; coordinate clicks remain a logged last resort.
- If the page remains unreadable after recovery, keep the live tab open for human visual review and record the supervision gap instead of declaring the image accepted.

The TikTok monitoring plan uses the same policy: short DOM/metadata reads, checkpoint after each page or tab state transition, and no screenshot polling loop.

In this Codex desktop runtime, the trusted browser client is loaded from the bundled Browser client, while the selected backend must still be Chrome extension:

```js
const { setupAtlasRuntime } = await import(
  "file:///C:/Users/EDY/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha2/scripts/browser-client.mjs"
);
await setupAtlasRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("extension");
```

This avoids the `browser-client is not trusted` failure from importing the Chrome plugin client path directly, but still uses the `@chrome` extension backend for ChatGPT web work.

### `mock`

Creates SVG placeholders and mock video descriptors. This is used for tests and package-shape validation.

### `chatgpt-web-image2`

Key-image adapter:

1. Use Codex Chrome extension backend when ChatGPT is already logged in.
2. Select/use ChatGPT web `image-2` only.
3. Submit only provider-compiled image prompts, not raw script text or workflow instructions.
4. Batch size is segment-specific: front first frames use 2-4 images, middle story images use 6-12, and back conversion/book b-roll uses 3-6. Fall back to one image when quality drops or ChatGPT returns panels.
5. Save generated assets into `03_key_images_chatgpt/`.
6. Run the same review loop and prompt iteration log.

Prompt contract:

- Begin with a direct image command: `Create one image now.` or `Create N separate images now, one image per item below.`
- Before sending the prompt, explicitly select the ChatGPT image-generation tool in the Codex Chrome plugin session. Do not rely on plain chat mode to infer image generation.
- Put aspect/output rules before creative content: one standalone `9:16` vertical full-frame image; no collage, storyboard page, split-screen, panel grid, picture-in-picture, or sequence.
- Use structured fields: style, subject type, shot intent, camera/composition, characters, action/relationship, micro-expression, background, lighting/dynamics, negative constraints.
- Keep shot IDs, review rules, provider notes, and download instructions outside the creative prompt body. They belong in Codex manifests and logs.
- If ChatGPT answers with analysis, rewrites the prompt, or merges shots into one page, record a provider prompt failure and retry with a shorter single-image prompt or explicitly select the image tool through the Codex Chrome plugin.

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

For the GPT-first MVP, Dreamina still-image generation is fallback only. ChatGPT is the primary image generator unless it is unavailable or a simple補图 task is explicitly routed to Dreamina.

### `dreamina-image-to-video`

Manual image-to-video task:

1. Generate and review the first-frame image in ChatGPT.
2. Upload the approved first frame to Dreamina image-to-video manually.
3. Copy the corresponding prompt from `07_review_log/dreamina_image_to_video_tasks.json`.
4. Save the returned video into `05_video_clips_dreamina/`.

Each prompt must describe script intent, first-frame continuity, action change, camera movement, emotional change, scene dynamics, duration, ending state, and negative constraints. Do not run image-to-video automatically or consume credits without explicit confirmation.

### `image-mvp`

GPT-first MVP route:

- ChatGPT creates the primary first-frame and story images.
- Dreamina image generation is fallback only.
- Existing video candidate shots remain video candidates in the storyboard, but this run prepares first-frame images plus manual Dreamina image-to-video tasks.
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
