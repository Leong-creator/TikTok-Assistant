import { advanceCollectionCursor, getCollectionBatch } from "./collection-plan.mjs";
import { collectCoBrowserSnapshots } from "./cobrowser-source.mjs";
import { persistCollectedSnapshots } from "./runner.mjs";

export async function runCoBrowserMonitorBatch({
  dataDir = "monitoring_data",
  now = new Date(),
  refreshPlan = false,
  config = {}
} = {}) {
  let batchState = await getCollectionBatch({
    dataDir,
    now,
    refreshPlan,
    maxVideoTargets: numberOrDefault(config.maxSeedVideos, 4),
    maxAccountTargets: numberOrDefault(config.maxAccounts, 3)
  });

  if (batchState.batch.done && !refreshPlan && batchState.cursor?.completed) {
    batchState = await getCollectionBatch({
      dataDir,
      now,
      refreshPlan: true,
      maxVideoTargets: numberOrDefault(config.maxSeedVideos, 4),
      maxAccountTargets: numberOrDefault(config.maxAccounts, 3)
    });
  }

  if (batchState.batch.done) {
    return {
      source: "cobrowser",
      collectedAt: new Date(now).toISOString(),
      planned: batchState.plan.counts,
      batch: batchState.batch,
      snapshots: { video: 0, product: 0 },
      failures: [],
      cursor: batchState.cursor
    };
  }

  const collection = await (config.collectCoBrowserSnapshots ?? collectCoBrowserSnapshots)({
    now,
    maxTabs: numberOrDefault(config.maxTabs, 2),
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

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}
