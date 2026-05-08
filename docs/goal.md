# Current Goal

```text
Complete the TikTok content production MVP without stopping until a script can be transformed into a local CapCut-ready asset folder containing structured scripts, storyboard, fixed-style prompts, reviewed key images, reviewed batch image/video generation outputs, an editing manifest, and a manual CapCut import guide. Do not stop except for required user login/authorization, paid-generation confirmation, or a hard external service blocker. Keep a checkpoint log after each milestone and verify every generated asset against the prompt before retrying or accepting it.
```

## Operational Notes

- The repository implementation uses the `mock` provider for unattended validation.
- ChatGPT web image generation is planned for key images through the Chrome extension backend.
- Dreamina batch generation is planned after CLI login and explicit paid-generation confirmation.
- No video generation command should run automatically during setup.

## Current External State

- Chrome extension backend is available.
- A Dreamina OAuth Device Flow login page was opened in Chrome.
- `dreamina user_credit` still reports no valid login until authorization is completed.
