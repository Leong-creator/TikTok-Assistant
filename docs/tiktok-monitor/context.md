# TikTok Monitor Context

This repository now carries both production tasks:

- content production: script to storyboard, prompts, reviewed images, and CapCut-ready local packages
- TikTok monitoring: account/video/shop collection, signal analysis, Feishu/Base reporting, and monitoring plugin packaging

The live monitoring data is intentionally local-only under `monitoring_data/`. It was copied back from `C:/Users/EDY/Desktop/TikTok Project Monitor/monitoring_data` so the existing TikTok monitoring conversation can continue from the unified main worktree.

## Current Runtime

- Main worktree: `C:/Users/EDY/Desktop/TikTok Project`
- Monitor data directory: `monitoring_data/`
- Default real monitor source: `cobrowser`
- Full cycle command: `npm run monitor:cycle`
- Bounded collection command: `npm run monitor:collect:cobrowser`
- Status command: `npm run monitor:status`

## Data Policy

`monitoring_data/` is ignored by git. Keep it on the local machine for the monitoring conversation and operational continuity. Do not commit browser profiles, cookies, tokens, localStorage, `.runtime/`, or generated release artifacts.

Tracked docs may summarize decisions, failures, and reusable lessons, but real account pools, private Feishu mappings, browser state, and live JSONL snapshots stay local unless explicitly redacted.

