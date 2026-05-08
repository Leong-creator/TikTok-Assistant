# Provider Integration

## Current Providers

### `mock`

Creates SVG placeholders and mock video descriptors. This is used for tests and package-shape validation.

### ChatGPT Web Key Images

Planned adapter:

1. Use Codex Chrome extension backend when ChatGPT is already logged in.
2. Submit only the selected key-image prompts.
3. Download or save generated assets into `03_key_images_chatgpt/`.
4. Run the same review loop and prompt iteration log.

Fallback: Codex image generation can produce key images when browser generation is unavailable.

### Dreamina

Planned adapter:

1. Require `dreamina login`.
2. Check `dreamina user_credit`.
3. Submit batch text-to-image tasks with `dreamina text2image`.
4. Submit selected image-to-video tasks with `dreamina image2video`.
5. Poll with `dreamina query_result`.
6. Save returned files and task metadata.

Generation commands consume credits and must be confirmed before execution.

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
