# Current Goal

```text
Build the GPT-first TikTok素材制作助手 MVP without disrupting existing pipeline behavior. ChatGPT handles script understanding, Chinese 钩子 review, segmented storyboards, key first-frame images, image review, prompt iteration, and final prompt复盘. The current operator MVP does not use the local App/MCP or GPT Action as the production entry; those remain developer-only packaging experiments. Do not run Dreamina image-to-video or any paid generation automatically. Stop only for required login, explicit paid-provider confirmation, or a hard external-service blocker, and record any blocker in the project logs.
```

## Operational Notes

- The repository implementation uses the `mock` provider for unattended validation.
- ChatGPT web image generation is the main image path: front first frames use smaller batches, middle images use larger batches, and back conversion/book b-roll uses moderate batches.
- Dreamina still-image generation is fallback only for the first GPT-first MVP.
- Dreamina image-to-video is the key manual downstream task, but no command should run automatically during setup.
- The local ChatGPT App exposes MCP tools for developer experiments only; it is not part of the current operator MVP.

## Current External State

- Local MCP/App server implementation is working for developer packaging experiments.
- ChatGPT Developer Mode App and custom GPT Action are not part of the current operator MVP.
- Formal production starts in the `TikTok素材制作助手` GPT chat itself, not through App, Action, Codex, or local package creation.
- Dreamina login and credit confirmation remain external blockers for real image-to-video generation.
