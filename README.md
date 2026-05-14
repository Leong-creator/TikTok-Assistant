# TikTok Content Pipeline MVP

Generate a local CapCut-ready asset package from a TikTok Shop script.

The MVP does not create a CapCut draft and does not depend on Dreamina-to-CapCut sync. It prepares a folder that a human editor can import into CapCut.

## Quick Start

Run tests:

```bash
npm test
```

Run a monitor dry run with mock TikTok data and no real Feishu send:

```bash
node src/monitor-cli.mjs run-once --source mock --targets accounts,shops --dry-run-alerts --alert-recipient <your_open_id>
```

Generate a test package with mock assets:

```bash
npm run generate:test
```

Generate the selected `top01_164k` reference sample with mock image-only assets:

```bash
npm run generate:top01:mock
```

Generate the same sample with Dreamina CLI images only:

```bash
npm run generate:top01:dreamina
```

Run the formal image MVP route:

```bash
npm run generate:top01:image-mvp
```

`generate:top01:image-mvp` routes the first three key images to ChatGPT web `image-2` and the remaining stills to Dreamina. It requires a Codex browser adapter for ChatGPT web image generation; it must not fall back to OpenAI API or another ChatGPT image model. Dreamina prompts are Chinese-only and use `model_version=4.0` by default for free image tests.

Run Dreamina with an explicit session and controlled concurrency:

```bash
node src/cli.mjs --script fixtures/top01-reference-script.txt --slug top01-reference-dreamina --mode test --provider dreamina-image --image-only --dreamina-session top01-reference --dreamina-concurrency 2
```

Retry only selected shots after review:

```bash
node src/cli.mjs --retry-package outputs/<date>-<slug> --shots S015,S016 --provider dreamina-image
```

The package is written to:

```text
outputs/<date>-<slug>/
```

Every generated package is indexed in `outputs/.index.json`, and each package writes Pixelle-style lifecycle checkpoints to `07_review_log/pipeline_checkpoints.jsonl`.

## Output

Each package contains:

- `00_script/`: original and localized script draft.
- `01_storyboard/`: shot list.
- `02_prompts/`: generated image and video prompts.
- `03_key_images_chatgpt/`: key-image provider output or mock placeholders.
- `04_bulk_images_dreamina/`: bulk image provider output or mock placeholders.
- `05_video_clips_dreamina/`: image-to-video output or mock descriptors.
- `06_editing_package/`: CapCut import manifest and manual import guide.
- `07_review_log/`: prompt iteration log, lifecycle checkpoints, ChatGPT session/task metadata, download move log, visual review log, and manual review list.

## Real Provider Status

- Dreamina image generation uses the official `dreamina` CLI only.
- Dreamina image generation defaults to `model_version=4.0` for image MVP tests.
- Dreamina tasks can be grouped by `--dreamina-session` and run with bounded concurrency via `--dreamina-concurrency`; timeout or rate-limit style errors should drop the next real batch to concurrency `1`.
- Provider failures are logged per shot and do not stop the full package.
- ChatGPT key-image generation uses ChatGPT web `image-2` because ChatGPT Pro does not include API usage.
- ChatGPT web tasks reuse one conversation per script, start with 3-image batches, may grow to 5/10 only after stable output, and must move browser downloads into `03_key_images_chatgpt/`.
- Video generation is not part of this MVP test; video candidate shots are generated as first-frame images.

## TikTok Data Monitor MVP

The monitor is separate from the content package generator. It writes local JSONL snapshots, growth signals, Feishu alert logs, and lead folders under `monitoring_data/`; that directory is ignored by git.

Seed files:

```text
monitoring_data/seeds/accounts.json
monitoring_data/seeds/shops.json
```

Account seed example:

```json
[
  {
    "id": "account-alpha",
    "handle": "book_alpha",
    "profileUrl": "https://www.tiktok.com/@book_alpha",
    "lastKnownPostAt": "2026-05-09T01:00:00.000Z",
    "enabled": true
  }
]
```

Shop seed example:

```json
[
  {
    "id": "shop-alpha",
    "name": "Alpha Books",
    "shopUrl": "https://www.tiktok.com/shop/alpha",
    "enabled": true
  }
]
```

Commands:

```bash
node src/monitor-cli.mjs run-once --source mock --targets accounts,shops --dry-run-alerts
node src/monitor-cli.mjs monitor-cycle --source cobrowser --data-dir monitoring_data
node src/monitor-cli.mjs collect --source mock --targets accounts,shops
node src/monitor-cli.mjs collect-cobrowser-batch --data-dir monitoring_data
node src/monitor-cli.mjs collect-persistent-batch --data-dir monitoring_data --max-seed-videos 4 --max-accounts 2
node src/monitor-cli.mjs collect-plan --data-dir monitoring_data
node src/monitor-cli.mjs collect-status --data-dir monitoring_data
node src/monitor-cli.mjs analyze
node src/monitor-cli.mjs alert --channel feishu-dm --alert-recipient <your_open_id>
node src/monitor-cli.mjs report --data-dir monitoring_data --alert-recipient <your_open_id>
node src/monitor-cli.mjs seed import-feishu --url <wiki_url> --from-file <exported_text_file>
node src/monitor-cli.mjs seed promote-candidates --data-dir monitoring_data
node src/monitor-cli.mjs base-sync --data-dir monitoring_data --base-token <base_token> --table-map '{"accounts":"tbl_x","videos":"tbl_y","signals":"tbl_z","products":"tbl_p"}'
```

Preferred npm scripts:

```bash
npm run monitor:cycle
npm run monitor:collect:cobrowser
npm run monitor:status
```

Chrome collection is exposed through `runChromePluginMonitor({ browser })` in `src/monitor/chrome-plugin-runner.mjs`. Use it from the Codex `@chrome` plugin runtime after binding the plugin browser object. The bridge uses only that plugin browser object; it does not start standalone Playwright, Chromium, the system browser, or another scraping channel.

### Stable background collection without the Chrome plugin

Use the formal CoBrowser-backed command when you need unattended collection:

```bash
node src/monitor-cli.mjs monitor-cycle --source cobrowser --data-dir monitoring_data
```

For bounded manual progress within the same plan/cursor cycle:

```bash
node src/monitor-cli.mjs collect-cobrowser-batch --data-dir monitoring_data
```

This source launches its own plugin-managed persistent Chrome profile through CoBrowser and does not depend on the Codex Chrome extension runtime. It collects only from visible public page content and must not read cookies, passwords, or localStorage tokens.

For browser bootstrap and login stability, this source should follow the OpenClaw pattern from `C:/Users/EDY/Desktop/Codex-claw/openclaw-workspace`: clone an already logged-in source profile into an automation-owned profile, launch that owned profile with `chromium.launchPersistentContext(..., { channel: "chrome" })`, and close only the context started by the automation.

If you want a portable command outside the repo, use the local `TikTok monitor` plugin wrapper:

```bash
node C:/Users/EDY/plugins/tiktok-monitor/scripts/tiktok-monitor.mjs cycle
```

The repository now assumes one shared source profile plus separate run profiles:
- TikTok monitor: headless run profile
- ChatGPT web work: headed run profile

Both run profiles may operate at the same time as long as they clone from the same source profile instead of sharing one live run profile.

For Chrome plugin runs, use bounded batches instead of one long full-pool pass. `buildChromePluginMonitorPlan({ dataDir })` writes a queue of evidence-video targets first and profile-only accounts second under `monitoring_data/state/`; `runChromePluginMonitorBatch({ browser, dataDir, config: { maxSeedVideos, maxAccounts } })` consumes the next batch, writes snapshots immediately, and advances the cursor so repeated short runs can work around the current `node_repl/js` 120-second tool limit.

Chrome discovery is exposed through `discoverChromePluginCandidates({ browser })` in the same runner module. It starts with shorter `People Skills` / `Raise Children Street Smart` query variants such as `people skill`, keeps the longer book phrases as fallbacks, writes account candidates to `monitoring_data/seeds/account_candidates.json`, proactively visits matched creator profiles to discover `shop` / `product` refs, writes those to `monitoring_data/seeds/shops.json`, and applies per-query and per-profile timeouts so one slow TikTok page does not stall the full batch.

When account candidates are ready for formal monitoring, promote them into `monitoring_data/seeds/accounts.json` with `node src/monitor-cli.mjs seed promote-candidates --data-dir monitoring_data` before the next account-only collection or Feishu Base sync.

The Chrome bridge enforces a ledger for owned tabs, defaults to at most two collector tabs, cleans up owned tabs on failure, and never closes pre-existing user tabs. It first reads public TikTok pages without requiring login. If TikTok hides metrics, shows a login wall, blocks by verification, or hides shop data, the collector writes a structured failure and continues with the rest of the batch.

All enabled, non-stale accounts are monitored at the same level. The default interval is three hours, and each account attempts to collect up to 60 public videos. Growth analysis prefers view deltas, then falls back to likes, shares, and comments when TikTok does not expose view counts.

Feishu Base dashboard sync uses `lark-cli base` only. It writes a local ignored `base_record_map.json` cache so repeated syncs update existing rows by `record-id` instead of creating duplicates.

Use `node src/monitor-cli.mjs report --data-dir monitoring_data --alert-recipient <your_open_id>` to send a Feishu DM summary of the current tracking pool, recent signals, and Base dashboard link.

During the test phase, Feishu alerts are private-message only. `feishu-chat` is intentionally rejected until group routing is explicitly enabled later.
