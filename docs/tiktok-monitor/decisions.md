# TikTok Monitor Decisions

## Repository Shape

- Keep content production and TikTok monitoring in one main repository.
- Keep `TikTok Project Monitor` only as a historical worktree until the unified main worktree is verified and pushed.
- Continue the original TikTok monitoring conversation against the unified main worktree instead of starting over.

## Browser Runtime

- Use CoBrowser as the formal TikTok monitor browser shell.
- Keep the OpenClaw-style profile model: source profile clone, automation-owned run profile, Chrome channel, dedicated page workflow, close only the automation-owned context.
- Do not use direct token scraping, cookies, localStorage reads, or profile database inspection.

## Plugin Distribution

- Keep `plugins/cobrowser` and `plugins/tiktok-monitor` in this repository.
- Publish plugin zip/tar artifacts through GitHub Releases.
- Keep `dist/` ignored in git; release packages are generated artifacts, not source.

## Operational Continuity

- Preserve `monitoring_data/` locally so existing account/video/shop context remains available to the monitoring conversation.
- Preserve historical branch heads with `archive/2026-05-15/*` tags before collapsing active development onto `main`.

