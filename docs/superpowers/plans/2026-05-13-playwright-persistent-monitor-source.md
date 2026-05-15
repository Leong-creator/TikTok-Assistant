# Playwright Persistent Monitor Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-Chrome-plugin TikTok monitor source that uses a persistent Playwright-managed Chrome profile for stable background collection while preserving the existing monitoring, analysis, Base sync, and Feishu reporting pipeline.

**Architecture:** Keep the current monitor pipeline shape intact: seed selection, collection, persistence, analysis, Base sync, and reporting remain unchanged. Introduce a new `playwright-persistent` browser client and source bootstrap layer that plugs into the existing `collectChromeSnapshots()` contract, so the collection engine can switch transport without rewriting analytics or reporting. Avoid reading cookies, passwords, localStorage, or direct bearer tokens; collect only from visible public pages plus Playwright-observable page state.

**Tech Stack:** Node.js ESM, Playwright persistent Chrome context, existing monitor JSONL storage, existing Feishu Base/reporting modules.

---

### Task 1: Add source configuration for persistent Playwright collection

**Files:**
- Modify: `src/monitor/config.mjs`
- Modify: `src/monitor-cli.mjs`
- Test: `tests/monitor-config.test.mjs`
- Test: `tests/monitor-cli.test.mjs`

- [ ] **Step 1: Write the failing config test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { resolveMonitorConfig } from "../src/monitor/config.mjs";

test("resolveMonitorConfig supports playwright-persistent source defaults", () => {
  const config = resolveMonitorConfig({
    TIKTOK_MONITOR_SOURCE: "playwright-persistent",
    TIKTOK_PLAYWRIGHT_PROFILE_DIR: "profiles/tiktok-monitor",
    TIKTOK_PLAYWRIGHT_HEADLESS: "true"
  });

  assert.equal(config.source, "playwright-persistent");
  assert.equal(config.playwrightProfileDir, "profiles/tiktok-monitor");
  assert.equal(config.playwrightHeadless, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-config.test.mjs`
Expected: FAIL because `resolveMonitorConfig()` does not return `playwrightProfileDir` or `playwrightHeadless`.

- [ ] **Step 3: Extend config parsing**

```js
export function resolveMonitorConfig(env = process.env) {
  return {
    dataDir: env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data",
    source: env.TIKTOK_MONITOR_SOURCE ?? "chrome",
    targets: parseTargets(env.TIKTOK_MONITOR_TARGETS ?? "accounts,shops,videos"),
    maxTabs: Number(env.TIKTOK_CHROME_MAX_TABS ?? 2),
    collectionIntervalHours: Number(env.TIKTOK_MONITOR_COLLECTION_INTERVAL_HOURS ?? 3),
    maxVideosPerAccount: Number(env.TIKTOK_CHROME_MAX_VIDEOS_PER_ACCOUNT ?? 60),
    maxProductsPerShop: Number(env.TIKTOK_CHROME_MAX_PRODUCTS_PER_SHOP ?? 6),
    playwrightProfileDir: env.TIKTOK_PLAYWRIGHT_PROFILE_DIR ?? ".runtime/browser/tiktok-monitor-profile",
    playwrightSeedProfileDir: env.TIKTOK_PLAYWRIGHT_SEED_PROFILE_DIR,
    playwrightHeadless: parseBoolean(env.TIKTOK_PLAYWRIGHT_HEADLESS, true),
    playwrightChannel: env.TIKTOK_PLAYWRIGHT_CHANNEL ?? "chrome",
    publicFirst: parseBoolean(env.TIKTOK_CHROME_PUBLIC_FIRST, true),
    requireLoginOnBlock: parseBoolean(env.TIKTOK_REQUIRE_LOGIN_ON_BLOCK, true),
    staleAccountDays: Number(env.TIKTOK_STALE_ACCOUNT_DAYS ?? 60),
    min3hViews: Number(env.TIKTOK_ALERT_MIN_3H_VIEWS ?? 3000),
    min6hViews: Number(env.TIKTOK_ALERT_MIN_6H_VIEWS ?? 3000),
    min24hViews: Number(env.TIKTOK_ALERT_MIN_24H_VIEWS ?? 10000),
    min3hLikes: Number(env.TIKTOK_ALERT_MIN_3H_LIKES ?? 3000),
    min3hShares: Number(env.TIKTOK_ALERT_MIN_3H_SHARES ?? 500),
    min3hComments: Number(env.TIKTOK_ALERT_MIN_3H_COMMENTS ?? 100),
    feishuAlertMode: env.FEISHU_ALERT_MODE ?? "dm",
    feishuDmOpenId: env.FEISHU_DM_OPEN_ID,
    feishuAlertChatId: env.FEISHU_ALERT_CHAT_ID,
    feishuBaseToken: env.FEISHU_BASE_TOKEN
  };
}
```

- [ ] **Step 4: Add CLI config plumbing**

```js
const config = {
  maxTabs: numberArg(args["max-tabs"], defaults.maxTabs),
  maxVideosPerAccount: numberArg(args["max-videos-per-account"], defaults.maxVideosPerAccount),
  maxProductsPerShop: numberArg(args["max-products-per-shop"], defaults.maxProductsPerShop),
  staleAccountDays: numberArg(args["stale-account-days"], defaults.staleAccountDays),
  min3hViews: numberArg(args["min-3h-views"], defaults.min3hViews),
  min6hViews: numberArg(args["min-6h-views"], defaults.min6hViews),
  min24hViews: numberArg(args["min-24h-views"], defaults.min24hViews),
  min3hLikes: numberArg(args["min-3h-likes"], defaults.min3hLikes),
  min3hShares: numberArg(args["min-3h-shares"], defaults.min3hShares),
  min3hComments: numberArg(args["min-3h-comments"], defaults.min3hComments),
  maxAccounts: numberArg(args["max-accounts"], undefined),
  maxShops: numberArg(args["max-shops"], undefined),
  maxSeedVideos: numberArg(args["max-seed-videos"], undefined),
  playwrightProfileDir: args["playwright-profile-dir"] ?? defaults.playwrightProfileDir,
  playwrightSeedProfileDir: args["playwright-seed-profile-dir"] ?? defaults.playwrightSeedProfileDir,
  playwrightHeadless: booleanArg(args["playwright-headless"], defaults.playwrightHeadless),
  playwrightChannel: args["playwright-channel"] ?? defaults.playwrightChannel,
  publicFirst: defaults.publicFirst,
  requireLoginOnBlock: defaults.requireLoginOnBlock
};
```

- [ ] **Step 5: Add the missing CLI helper**

```js
function booleanArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return /^(1|true|yes)$/iu.test(String(value));
}
```

- [ ] **Step 6: Run config and CLI tests**

Run: `node --test tests/monitor-config.test.mjs tests/monitor-cli.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/monitor/config.mjs src/monitor-cli.mjs tests/monitor-config.test.mjs tests/monitor-cli.test.mjs
git commit -m "feat: add playwright persistent monitor config"
```

### Task 2: Add Playwright persistent browser bootstrap

**Files:**
- Create: `src/monitor/playwright-persistent-runtime.mjs`
- Test: `tests/monitor-playwright-runtime.test.mjs`

- [ ] **Step 1: Write the failing runtime test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createPlaywrightLaunchOptions } from "../src/monitor/playwright-persistent-runtime.mjs";

test("createPlaywrightLaunchOptions builds persistent chrome launch config", () => {
  const options = createPlaywrightLaunchOptions({
    headless: true,
    channel: "chrome"
  });

  assert.equal(options.channel, "chrome");
  assert.equal(options.headless, true);
  assert.deepEqual(options.viewport, { width: 1440, height: 960 });
  assert.match(options.args.join(" "), /disable-blink-features=AutomationControlled/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-playwright-runtime.test.mjs`
Expected: FAIL because the runtime module does not exist.

- [ ] **Step 3: Create the runtime helper**

```js
import fs from "node:fs";
import path from "node:path";

export function createPlaywrightLaunchOptions({ headless = true, channel = "chrome" } = {}) {
  return {
    channel,
    headless,
    acceptDownloads: false,
    viewport: { width: 1440, height: 960 },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      "--window-size=1440,960"
    ]
  };
}

export function ensureSeededProfile({ profileDir, seedProfileDir }) {
  if (fs.existsSync(profileDir) || !seedProfileDir) return false;
  fs.cpSync(seedProfileDir, profileDir, {
    recursive: true,
    filter(source) {
      return !/Singleton|lock|Cache|Code Cache|GPUCache|Crashpad|BrowserMetrics|DevToolsActivePort/i.test(source);
    }
  });
  return true;
}
```

- [ ] **Step 4: Add the context bootstrap**

```js
export async function startPlaywrightPersistentContext({
  playwright,
  profileDir,
  seedProfileDir,
  headless = true,
  channel = "chrome"
}) {
  ensureSeededProfile({ profileDir, seedProfileDir });
  return playwright.chromium.launchPersistentContext(
    path.resolve(profileDir),
    createPlaywrightLaunchOptions({ headless, channel })
  );
}
```

- [ ] **Step 5: Run the runtime test**

Run: `node --test tests/monitor-playwright-runtime.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/monitor/playwright-persistent-runtime.mjs tests/monitor-playwright-runtime.test.mjs
git commit -m "feat: add persistent playwright runtime bootstrap"
```

### Task 3: Add a Playwright-backed browser client compatible with the existing collector

**Files:**
- Create: `src/monitor/playwright-browser-client.mjs`
- Test: `tests/monitor-playwright-browser-client.test.mjs`

- [ ] **Step 1: Write the failing browser client contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createPlaywrightBrowserClient } from "../src/monitor/playwright-browser-client.mjs";

test("playwright browser client exposes the collector contract", () => {
  const client = createPlaywrightBrowserClient({
    context: {
      newPage() {},
      pages() {
        return [];
      }
    }
  });

  assert.equal(typeof client.createTab, "function");
  assert.equal(typeof client.closeTab, "function");
  assert.equal(typeof client.navigate, "function");
  assert.equal(typeof client.extractDirectVideo, "function");
  assert.equal(client.usesDetailTab, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-playwright-browser-client.test.mjs`
Expected: FAIL because the browser client module does not exist.

- [ ] **Step 3: Create a tab wrapper over Playwright pages**

```js
function wrapPage(page) {
  return {
    id: page.guid ?? `page-${Date.now()}`,
    playwright: {
      async domSnapshot() {
        return page.content();
      },
      async waitForLoadState({ state, timeoutMs }) {
        return page.waitForLoadState(state, { timeout: timeoutMs });
      }
    },
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    },
    async close() {
      await page.close();
    }
  };
}
```

- [ ] **Step 4: Reuse the existing parsers instead of forking logic**

```js
import {
  parseTikTokProfileVideos,
  parseTikTokVideoDetail,
  parseTikTokShopProducts
} from "./chrome-plugin-bridge.mjs";
import { parseTikTokProfileShopRefs, parseTikTokSearchResults } from "./discovery.mjs";
```

- [ ] **Step 5: Implement the collector contract**

```js
export function createPlaywrightBrowserClient({ context, timeoutMs = 15_000, maxVideosPerAccount = 6, maxProductsPerShop = 6 } = {}) {
  return {
    usesDetailTab: true,
    async createTab() {
      return wrapPage(await context.newPage());
    },
    async closeTab(tab) {
      if (tab?.close) await tab.close();
    },
    async navigate(tab, url) {
      await tab.goto(url);
      await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs });
    },
    async extractDirectVideo({ detailTab, video }) {
      return parseTikTokVideoDetail(await detailTab.playwright.domSnapshot(), {
        videoUrl: video.videoUrl,
        accountHandle: video.accountHandle
      });
    }
  };
}
```

- [ ] **Step 6: Run the client test**

Run: `node --test tests/monitor-playwright-browser-client.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/monitor/playwright-browser-client.mjs tests/monitor-playwright-browser-client.test.mjs
git commit -m "feat: add playwright browser client contract"
```

### Task 4: Wire the new source into the monitor pipeline

**Files:**
- Modify: `src/monitor/runner.mjs`
- Create: `src/monitor/playwright-persistent-source.mjs`
- Test: `tests/monitor-runner.test.mjs`
- Test: `tests/monitor-cli.test.mjs`

- [ ] **Step 1: Write the failing runner test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { collectMonitorSnapshots } from "../src/monitor/runner.mjs";

test("collectMonitorSnapshots dispatches to playwright-persistent source", async () => {
  await assert.rejects(
    () =>
      collectMonitorSnapshots({
        dataDir: "monitoring_data",
        source: "playwright-persistent",
        targets: ["videos"],
        now: new Date("2026-05-13T00:00:00Z"),
        config: {}
      }),
    /playwright/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-runner.test.mjs tests/monitor-cli.test.mjs`
Expected: FAIL because `unsupported monitor source: playwright-persistent`.

- [ ] **Step 3: Create the source bootstrap**

```js
import { createPlaywrightBrowserClient } from "./playwright-browser-client.mjs";
import { startPlaywrightPersistentContext } from "./playwright-persistent-runtime.mjs";
import { collectChromeSnapshots } from "./chrome-source.mjs";

export async function collectPlaywrightPersistentSnapshots({
  playwright,
  now,
  maxTabs,
  accounts,
  shops,
  videos,
  config
}) {
  const context = await startPlaywrightPersistentContext({
    playwright,
    profileDir: config.playwrightProfileDir,
    seedProfileDir: config.playwrightSeedProfileDir,
    headless: config.playwrightHeadless,
    channel: config.playwrightChannel
  });

  try {
    const browserClient = createPlaywrightBrowserClient({
      context,
      timeoutMs: config.timeoutMs,
      maxVideosPerAccount: config.maxVideosPerAccount,
      maxProductsPerShop: config.maxProductsPerShop
    });
    return collectChromeSnapshots({ now, maxTabs, browserClient, accounts, shops, videos });
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Update runner dispatch**

```js
async function collectSnapshots(options) {
  if (options.source === "chrome") {
    return collectChromeSnapshots(options);
  }
  if (options.source === "playwright-persistent") {
    const { chromium } = await import("playwright");
    return collectPlaywrightPersistentSnapshots({
      ...options,
      playwright: { chromium },
      config: options
    });
  }
  if (options.source === "mock") {
    return collectMockSnapshots(options);
  }
  throw new Error(`unsupported monitor source: ${options.source}`);
}
```

- [ ] **Step 5: Add a CLI smoke test for the new source**

```js
test("monitor CLI accepts playwright-persistent source", async () => {
  const result = await runCommand("collect", {
    _: ["collect"],
    source: "playwright-persistent",
    "data-dir": "monitoring_data",
    "dry-run-alerts": true
  }, defaults);

  assert.ok(result);
});
```

- [ ] **Step 6: Run runner and CLI tests**

Run: `node --test tests/monitor-runner.test.mjs tests/monitor-cli.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/monitor/runner.mjs src/monitor/playwright-persistent-source.mjs tests/monitor-runner.test.mjs tests/monitor-cli.test.mjs
git commit -m "feat: wire persistent playwright source into monitor pipeline"
```

### Task 5: Add a stable batch runner for full collection without Chrome plugin limits

**Files:**
- Modify: `src/monitor/collection-plan.mjs`
- Modify: `src/monitor-cli.mjs`
- Create: `src/monitor/playwright-persistent-runner.mjs`
- Test: `tests/monitor-collection-plan.test.mjs`
- Test: `tests/monitor-cli.test.mjs`

- [ ] **Step 1: Write the failing batch-runner test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { runPlaywrightPersistentMonitorBatch } from "../src/monitor/playwright-persistent-runner.mjs";

test("persistent batch runner advances collection cursor", async () => {
  const result = await runPlaywrightPersistentMonitorBatch({
    dataDir: "tests/fixtures/monitoring_data",
    now: new Date("2026-05-13T00:00:00Z"),
    config: { maxSeedVideos: 2, maxAccounts: 1 }
  });

  assert.equal(typeof result.cursor.videoIndex, "number");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-collection-plan.test.mjs tests/monitor-cli.test.mjs`
Expected: FAIL because the persistent batch runner does not exist.

- [ ] **Step 3: Reuse the existing plan/cursor system**

```js
import { advanceCollectionCursor, getCollectionBatch } from "./collection-plan.mjs";
import { persistCollectedSnapshots } from "./runner.mjs";
import { collectPlaywrightPersistentSnapshots } from "./playwright-persistent-source.mjs";
```

- [ ] **Step 4: Implement the persistent batch runner**

```js
export async function runPlaywrightPersistentMonitorBatch({
  dataDir = "monitoring_data",
  now = new Date(),
  refreshPlan = false,
  config = {}
} = {}) {
  const batchState = await getCollectionBatch({
    dataDir,
    now,
    refreshPlan,
    maxVideoTargets: Number(config.maxSeedVideos ?? 4),
    maxAccountTargets: Number(config.maxAccounts ?? 2)
  });

  if (batchState.batch.done) {
    return { batch: batchState.batch, cursor: batchState.cursor, snapshots: { video: 0, product: 0 } };
  }

  const collection = await collectPlaywrightPersistentSnapshots({
    now,
    maxTabs: Number(config.maxTabs ?? 2),
    accounts: batchState.batch.accounts,
    shops: [],
    videos: batchState.batch.videos,
    config
  });

  await persistCollectedSnapshots({ dataDir, collection, now });
  const cursor = await advanceCollectionCursor({
    dataDir,
    consumedVideos: batchState.batch.videos.length,
    consumedAccounts: batchState.batch.accounts.length
  });

  return {
    batch: { videos: batchState.batch.videos.length, accounts: batchState.batch.accounts.length, done: false },
    cursor,
    snapshots: { video: collection.videoSnapshots.length, product: collection.productSnapshots.length },
    failures: collection.failures
  };
}
```

- [ ] **Step 5: Expose a CLI entrypoint**

```js
if (command === "collect-persistent-batch") {
  return runPlaywrightPersistentMonitorBatch({
    dataDir,
    now,
    refreshPlan: Boolean(args["refresh-plan"]),
    config
  });
}
```

- [ ] **Step 6: Run tests**

Run: `node --test tests/monitor-collection-plan.test.mjs tests/monitor-cli.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/monitor-cli.mjs src/monitor/playwright-persistent-runner.mjs src/monitor/collection-plan.mjs tests/monitor-collection-plan.test.mjs tests/monitor-cli.test.mjs
git commit -m "feat: add persistent batch monitor runner"
```

### Task 6: Document operating model, guardrails, and rollout checks

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Test: manual smoke run in `monitoring_data`

- [ ] **Step 1: Update `.env.example`**

```env
TIKTOK_MONITOR_SOURCE=playwright-persistent
TIKTOK_PLAYWRIGHT_PROFILE_DIR=.runtime/browser/tiktok-monitor-profile
TIKTOK_PLAYWRIGHT_SEED_PROFILE_DIR=
TIKTOK_PLAYWRIGHT_HEADLESS=true
TIKTOK_PLAYWRIGHT_CHANNEL=chrome
```

- [ ] **Step 2: Update README usage**

```md
### Stable background collection without the Chrome plugin

Use the persistent Playwright source when you need unattended collection:

```bash
node src/monitor-cli.mjs collect-persistent-batch --data-dir monitoring_data --max-seed-videos 4 --max-accounts 2
```

This source launches its own persistent Chrome profile and does not depend on the Codex Chrome extension runtime.
It collects only from visible public page content and does not read cookies, passwords, or localStorage tokens.
```

- [ ] **Step 3: Update `AGENTS.md` guardrail**

```md
- For TikTok monitor background automation, prefer the repository's `playwright-persistent` source over Codex Chrome plugin collection.
- Do not add direct token scraping, cookie extraction, or localStorage reads to the TikTok monitor pipeline.
```

- [ ] **Step 4: Run a manual smoke command**

Run: `node src/monitor-cli.mjs collect-persistent-batch --data-dir monitoring_data --max-seed-videos 1 --max-accounts 1`
Expected: one small batch completes or returns page-level failures without source bootstrap failure.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example AGENTS.md
git commit -m "docs: document persistent playwright monitor source"
```

## Spec coverage checklist

- Replace unstable Chrome plugin transport for unattended monitoring: covered by Tasks 2-5.
- Preserve current monitor pipeline and downstream reporting: covered by Tasks 3-5.
- Avoid token/localStorage scraping in the TikTok path: covered by Architecture plus Task 6.
- Keep rollout isolated on a dedicated branch: satisfied by branch `codex/tiktok-playwright-persistent`.

## Risks to verify during implementation

- TikTok public pages may still hide metrics even on persistent Playwright; transport stability and page data availability are separate problems.
- Headless Chrome may expose different DOM than headed Chrome; if that happens, add a config switch to run headed in the automation-owned profile for debugging only.
- Profile seeding must remain one-way into an automation-owned directory; never point the collector at the user's live Chrome profile.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-13-playwright-persistent-monitor-source.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - execute tasks in this session, batch execution with checkpoints
