import path from "node:path";

import {
  advanceCollectionCursor,
  getCollectionBatch,
  rebuildWhitelistVideoTargetsAfterAccountCoverage,
  writeCollectionCursor
} from "./collection-plan.mjs";
import {
  collectCloakBrowserSnapshots,
  discoverCloakBrowserAccountCandidates
} from "./cloakbrowser-source.mjs";
import { DEFAULT_TIKTOK_DISCOVERY_QUERIES } from "./discovery.mjs";
import { persistCollectedSnapshots } from "./runner.mjs";
import { readJsonLines } from "./storage.mjs";

export async function runCloakBrowserMonitorBatch({
  dataDir = "monitoring_data",
  now = new Date(),
  refreshPlan = false,
  config = {}
} = {}) {
  const disablePlanRollover = Boolean(config.disablePlanRollover);
  if (shouldRefreshDiscovery({ refreshPlan, config })) {
    await runDiscoveryRefresh({ dataDir, now, config });
  }

  let batchState = await getCollectionBatch({
    dataDir,
    now,
    refreshPlan,
    maxVideoTargets: numberOrDefault(config.maxSeedVideos, 1),
    maxAccountTargets: numberOrDefault(config.maxAccounts, 1)
  });

  if (!disablePlanRollover && batchState.batch.done && !refreshPlan && batchState.cursor?.completed) {
    if (shouldRefreshDiscovery({ refreshPlan: true, config })) {
      await runDiscoveryRefresh({ dataDir, now, config });
    }
    batchState = await getCollectionBatch({
      dataDir,
      now,
      refreshPlan: true,
      maxVideoTargets: numberOrDefault(config.maxSeedVideos, 1),
      maxAccountTargets: numberOrDefault(config.maxAccounts, 1)
    });
  }

  if (batchState.batch.done) {
    return {
      source: "cloakbrowser",
      collectedAt: new Date(now).toISOString(),
      planned: batchState.plan.counts,
      batch: batchState.batch,
      snapshots: { video: 0, product: 0 },
      failures: [],
      cursor: batchState.cursor
    };
  }

  const collection = await (config.collectCloakBrowserSnapshots ?? collectCloakBrowserSnapshots)({
    now,
    maxTabs: numberOrDefault(config.maxTabs, 1),
    accounts: batchState.batch.accounts,
    shops: [],
    videos: await enrichVideoBatchWithLatestSnapshots({ dataDir, videos: batchState.batch.videos }),
    config
  });

  const processedVideos = Number(collection.processed?.videoTargets ?? batchState.batch.videos.length);
  const processedAccounts = Number(collection.processed?.accountTargets ?? batchState.batch.accounts.length);
  await persistCollectedSnapshots({ dataDir, collection, now });
  const cursor = await advanceCollectionCursor({
    dataDir,
    consumedVideos: processedVideos,
    consumedAccounts: processedAccounts
  });

  let nextCursor = cursor;
  if (
    processedAccounts > 0 &&
    batchState.batch.videos.length === 0 &&
    nextCursor.accountIndex >= Number(batchState.plan?.counts?.accountTargets ?? 0) &&
    nextCursor.videoIndex === 0
  ) {
    const rebuiltPlan = await rebuildWhitelistVideoTargetsAfterAccountCoverage({
      dataDir,
      now,
      cycleStartedAt: batchState.cursor?.planCreatedAt ?? batchState.plan?.createdAt
    });
    nextCursor = {
      ...nextCursor,
      videoIndex: 0,
      completed: rebuiltPlan.videoTargets.length === 0
    };
    await writeCollectionCursor(dataDir, nextCursor);
  }

  return {
    source: collection.source,
    collectedAt: collection.collectedAt,
    planned: batchState.plan.counts,
    batch: {
      videos: processedVideos,
      accounts: processedAccounts,
      queuedVideos: batchState.batch.videos.length,
      queuedAccounts: batchState.batch.accounts.length,
      done: false
    },
    snapshots: {
      video: collection.videoSnapshots.length,
      product: collection.productSnapshots.length
    },
    failures: collection.failures,
    cursor: nextCursor,
    recycleRequested: Boolean(collection.recycleRequested),
    stopReason: collection.stopReason ?? null
  };
}

async function enrichVideoBatchWithLatestSnapshots({ dataDir, videos = [] } = {}) {
  if (!Array.isArray(videos) || videos.length === 0) return [];
  const snapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const latestByVideoUrl = new Map();
  for (const snapshot of snapshots) {
    const videoUrl = String(snapshot.videoUrl ?? "").trim();
    if (!videoUrl) continue;
    const current = latestByVideoUrl.get(videoUrl);
    const collectedAt = snapshot.collectedAt ? new Date(snapshot.collectedAt).getTime() : 0;
    const currentCollectedAt = current?.collectedAt ? new Date(current.collectedAt).getTime() : -1;
    if (!current || collectedAt >= currentCollectedAt) {
      latestByVideoUrl.set(videoUrl, snapshot);
    }
  }
  return videos.map((video) => {
    const latest = latestByVideoUrl.get(String(video.videoUrl ?? "").trim());
    if (!latest) return video;
    return {
      ...video,
      views: Number(latest.views ?? video.views ?? 0),
      likes: Number(latest.likes ?? video.likes ?? 0),
      comments: Number(latest.comments ?? video.comments ?? 0),
      shares: Number(latest.shares ?? video.shares ?? 0),
      caption: latest.caption ?? video.caption ?? "",
      productRefs: Array.isArray(latest.productRefs) ? latest.productRefs : video.productRefs ?? [],
      postedAt: latest.postedAt ?? video.postedAt ?? video.latestPublishedAt ?? null
    };
  });
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function shouldRefreshDiscovery({ refreshPlan, config }) {
  return refreshPlan && (config.enableDiscoveryRefresh ?? true);
}

async function runDiscoveryRefresh({ dataDir, now, config }) {
  const discover = config.discoverCloakBrowserAccountCandidates ?? discoverCloakBrowserAccountCandidates;
  await discover({
    dataDir,
    now,
    queries: config.discoveryQueries ?? DEFAULT_TIKTOK_DISCOVERY_QUERIES,
    config
  });
}
