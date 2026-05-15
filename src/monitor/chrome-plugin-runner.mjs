import { createChromePluginBrowserClient } from "./chrome-plugin-bridge.mjs";
import {
  advanceCollectionCursor,
  createCollectionPlan,
  getCollectionBatch
} from "./collection-plan.mjs";
import {
  discoverChromeAccountCandidates,
  discoverChromeShopsFromAccounts,
  DEFAULT_TIKTOK_DISCOVERY_QUERIES
} from "./discovery.mjs";
import { persistCollectedSnapshots, runMonitorOnce } from "./runner.mjs";
import { collectChromeSnapshots } from "./chrome-source.mjs";

export async function runChromePluginMonitor({
  browser,
  dataDir = "monitoring_data",
  targets = ["accounts", "shops"],
  now = new Date(),
  alertRecipient,
  notifier,
  config = {}
} = {}) {
  const browserClient = createChromePluginBrowserClient({
    browser,
    ...buildChromePluginBrowserClientConfig(config)
  });

  return runMonitorOnce({
    dataDir,
    source: "chrome",
    targets,
    now,
    browserClient,
    alertMode: "dm",
    alertRecipient,
    notifier,
    config: {
      maxTabs: Number(config.maxTabs ?? 2),
      min3hViews: Number(config.min3hViews ?? 3000),
      min6hViews: Number(config.min6hViews ?? 3000),
      min24hViews: Number(config.min24hViews ?? 10000),
      min3hLikes: Number(config.min3hLikes ?? 3000),
      min3hShares: Number(config.min3hShares ?? 500),
      min3hComments: Number(config.min3hComments ?? 100),
      staleAccountDays: Number(config.staleAccountDays ?? 60)
    }
  });
}

export async function discoverChromePluginCandidates({
  browser,
  dataDir = "monitoring_data",
  queries = DEFAULT_TIKTOK_DISCOVERY_QUERIES,
  now = new Date(),
  config = {}
} = {}) {
  const browserClient = createChromePluginBrowserClient({
    browser,
    ...buildChromePluginBrowserClientConfig(config)
  });

  return discoverChromeAccountCandidates({
    dataDir,
    browserClient,
    queries,
    now,
    maxTabs: Number(config.maxTabs ?? 2),
    queryTimeoutMs: Number(config.queryTimeoutMs ?? 45_000)
  });
}

export async function discoverChromePluginShopsFromAccounts({
  browser,
  dataDir = "monitoring_data",
  accounts = [],
  now = new Date(),
  config = {}
} = {}) {
  const browserClient = createChromePluginBrowserClient({
    browser,
    ...buildChromePluginBrowserClientConfig(config)
  });

  return discoverChromeShopsFromAccounts({
    dataDir,
    browserClient,
    accounts,
    now,
    maxTabs: Number(config.maxTabs ?? 1),
    maxEvidenceVideosPerAccount: Number(config.maxEvidenceVideosPerAccount ?? 2),
    maxProfileVideosPerAccount: Number(config.maxProfileVideosPerAccount ?? 2)
  });
}

export async function runChromePluginMonitorBatch({
  browser,
  dataDir = "monitoring_data",
  now = new Date(),
  refreshPlan = false,
  config = {}
} = {}) {
  const browserClient = createChromePluginBrowserClient({
    browser,
    ...buildChromePluginBrowserClientConfig(config)
  });
  const batchState = await getCollectionBatch({
    dataDir,
    now,
    refreshPlan,
    maxVideoTargets: numberOrDefault(config.maxSeedVideos, 4),
    maxAccountTargets: numberOrDefault(config.maxAccounts, 3)
  });

  if (batchState.batch.done) {
    return {
      source: "chrome",
      collectedAt: new Date(now).toISOString(),
      planned: batchState.plan.counts,
      batch: batchState.batch,
      snapshots: { video: 0, product: 0 },
      failures: [],
      cursor: batchState.cursor
    };
  }

  const collection = await collectChromeSnapshots({
    now,
    maxTabs: Number(config.maxTabs ?? 2),
    browserClient,
    videos: batchState.batch.videos,
    accounts: batchState.batch.accounts,
    shops: []
  });
  await persistCollectedSnapshots({ dataDir, collection, now });
  const cursor = await advanceCollectionCursor({
    dataDir,
    consumedVideos: batchState.batch.videos.length,
    consumedAccounts: batchState.batch.accounts.length
  });

  return {
    source: collection.source,
    collectedAt: collection.collectedAt,
    planned: batchState.plan.counts,
    batch: {
      videos: batchState.batch.videos.length,
      accounts: batchState.batch.accounts.length,
      done: false
    },
    snapshots: {
      video: collection.videoSnapshots.length,
      product: collection.productSnapshots.length
    },
    failures: collection.failures,
    cursor
  };
}

export async function buildChromePluginMonitorPlan({
  dataDir = "monitoring_data",
  now = new Date()
} = {}) {
  return createCollectionPlan({ dataDir, now });
}

function buildChromePluginBrowserClientConfig(config = {}) {
  return {
    maxVideosPerAccount: numberOrDefault(config.maxVideosPerAccount, 60),
    maxProductsPerShop: numberOrDefault(config.maxProductsPerShop, 6),
    waitUntil: config.waitUntil ?? "domcontentloaded",
    timeoutMs: numberOrDefault(config.timeoutMs, 15_000),
    snapshotTimeoutMs: numberOrDefault(config.snapshotTimeoutMs ?? config.timeoutMs, 15_000),
    closeTimeoutMs: numberOrDefault(config.closeTimeoutMs, 5_000),
    snapshotRetries: numberOrDefault(config.snapshotRetries, 8),
    snapshotRetryDelayMs: numberOrDefault(config.snapshotRetryDelayMs, 1_000)
  };
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}
