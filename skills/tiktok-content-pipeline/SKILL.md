---
name: tiktok-content-pipeline
description: Generate a local CapCut-ready TikTok content asset package from a script, including storyboard, fixed-style prompts, generated assets, review logs, and editing manifests.
---

# TikTok Content Pipeline

Use this skill when the user provides a TikTok Shop script and wants Codex to prepare AI-generated content assets for manual CapCut editing.

## Workflow

1. Confirm the script file or paste-in script.
2. Run the MVP generator:
   ```bash
   node src/cli.mjs --script fixtures/sample-script.txt --slug demo --mode test --provider mock
   ```
3. For real generation, prepare provider credentials first:
   - ChatGPT web login through the browser plugin.
   - `dreamina login` for Dreamina.
4. Review `06_editing_package/editing_manifest.csv`.
5. Import assets into CapCut manually.

## Provider Safety

- Use `mock` for validation.
- Do not run paid Dreamina generation without explicit confirmation.
- Keep task IDs, prompts, and review results in the output folder.
