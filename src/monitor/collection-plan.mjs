import path from "node:path";

import { ensureMonitorDataDirs, readJsonFile, readJsonLines, writeJsonFile } from "./storage.mjs";
import { isCanonicalTikTokVideoUrl } from "./video-time.mjs";
import { isWhitelistSourceConfigured, loadWhitelistAccounts } from "./whitelist-accounts.mjs";

const PLAN_FILE = "chrome_collect_plan.json";
const CURSOR_FILE = "chrome_collect_cursor.json";
const DEFAULT_RECENT_VIDEO_DAYS = 90;

export async function createCollectionPlan({
  dataDir = "monitoring_data",
  now = new Date(),
  whitelistAccounts,
  baseDashboardConfigPath,
  excludeVideosCollectedSince
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const accounts = whitelistAccounts ?? await loadWhitelistAccounts({ dataDir, baseDashboardConfigPath });
  const whitelistConfigured = Array.isArray(whitelistAccounts)
    ? true
    : await isWhitelistSourceConfigured({ dataDir, baseDashboardConfigPath });
  const snapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const plan = whitelistConfigured
    ? buildCollectionPlan({ accounts, snapshots, now, whitelistMode: true, excludeVideosCollectedSince })
    : buildCollectionPlan({
        accounts: await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []),
        candidates: await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []),
        snapshots,
        now
      });
  await writeJsonFile(resolveStatePath(dataDir, PLAN_FILE), plan);
  await writeJsonFile(resolveStatePath(dataDir, CURSOR_FILE), createInitialCursor(plan));
  return plan;
}

export async function readCollectionPlan(dataDir = "monitoring_data") {
  return readJsonFile(resolveStatePath(dataDir, PLAN_FILE), null);
}

export async function readCollectionCursor(dataDir = "monitoring_data") {
  return readJsonFile(resolveStatePath(dataDir, CURSOR_FILE), null);
}

export async function writeCollectionCursor(dataDir = "monitoring_data", cursor) {
  await ensureMonitorDataDirs(dataDir);
  await writeJsonFile(resolveStatePath(dataDir, CURSOR_FILE), cursor);
}

export async function rebuildWhitelistVideoTargetsAfterAccountCoverage({
  dataDir = "monitoring_data",
  now = new Date(),
  cycleStartedAt
} = {}) {
  const currentPlan = await readCollectionPlan(dataDir);
  if (!currentPlan?.accountTargets?.length) {
    return currentPlan;
  }

  const snapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const activeHandles = new Set(
    currentPlan.accountTargets
      .map((account) => String(account.handle ?? "").trim())
      .filter(Boolean)
  );
  const snapshotVideoTargets = summarizeSnapshotVideoTargets(
    snapshots.filter((snapshot) => activeHandles.has(String(snapshot.accountHandle ?? "").trim())),
    {
      now,
      recentVideoDays: DEFAULT_RECENT_VIDEO_DAYS,
      excludeVideosCollectedSince: cycleStartedAt
    }
  ).sort(compareVideoTargetsByRecency);

  const nextPlan = {
    ...currentPlan,
    counts: {
      ...currentPlan.counts,
      videoTargets: snapshotVideoTargets.length,
      accountTargets: currentPlan.accountTargets.length
    },
    videoTargets: snapshotVideoTargets
  };

  await writeJsonFile(resolveStatePath(dataDir, PLAN_FILE), nextPlan);
  return nextPlan;
}

export async function getCollectionBatch({
  dataDir = "monitoring_data",
  now = new Date(),
  maxVideoTargets = 4,
  maxAccountTargets = 3,
  refreshPlan = false
} = {}) {
  const plan = refreshPlan ? await createCollectionPlan({ dataDir, now }) : (await readCollectionPlan(dataDir)) ?? (await createCollectionPlan({ dataDir, now }));
  const cursor = (await readCollectionCursor(dataDir)) ?? createInitialCursor(plan);
  if (cursor.planCreatedAt !== plan.createdAt) {
    const resetCursor = createInitialCursor(plan);
    await writeCollectionCursor(dataDir, resetCursor);
    return getCollectionBatch({ dataDir, now, maxVideoTargets, maxAccountTargets, refreshPlan: false });
  }

  const accountStart = Number(cursor.accountIndex ?? 0);
  const videoStart = Number(cursor.videoIndex ?? 0);
  const accounts = plan.accountTargets.slice(accountStart, accountStart + maxAccountTargets);
  const videos = accounts.length
    ? []
    : plan.videoTargets.slice(videoStart, videoStart + maxVideoTargets);
  const done = videos.length === 0 && accounts.length === 0;

  return {
    plan,
    cursor,
    batch: {
      videos,
      accounts,
      done
    }
  };
}

export async function advanceCollectionCursor({
  dataDir = "monitoring_data",
  consumedVideos = 0,
  consumedAccounts = 0
} = {}) {
  const plan = await readCollectionPlan(dataDir);
  const current = (await readCollectionCursor(dataDir)) ?? createInitialCursor(plan ?? { createdAt: null, videoTargets: [], accountTargets: [] });
  const next = {
    ...current,
    videoIndex: Number(current.videoIndex ?? 0) + Number(consumedVideos ?? 0),
    accountIndex: Number(current.accountIndex ?? 0) + Number(consumedAccounts ?? 0)
  };
  if (plan) {
    next.completed =
      next.videoIndex >= plan.videoTargets.length &&
      next.accountIndex >= plan.accountTargets.length;
  }
  await writeCollectionCursor(dataDir, next);
  return next;
}

export function buildCollectionPlan({
  accounts = [],
  candidates = [],
  snapshots = [],
  now = new Date(),
  recentVideoDays = DEFAULT_RECENT_VIDEO_DAYS,
  whitelistMode = false,
  excludeVideosCollectedSince
} = {}) {
  if (whitelistMode || accounts.some((account) => Array.isArray(account?.sourceTables))) {
    return buildWhitelistCollectionPlan({ accounts, snapshots, now, recentVideoDays, excludeVideosCollectedSince });
  }
  const snapshotSummariesByHandle = summarizeSnapshotsByHandle(snapshots);
  const videoTargetsByUrl = new Map(
    summarizeSnapshotVideoTargets(snapshots, {
      now,
      recentVideoDays
    }).map((target) => [target.videoUrl, target])
  );

  const candidateByHandle = new Map();
  for (const candidate of candidates) {
    const handle = String(candidate.handle ?? "").trim();
    if (!handle) continue;
    candidateByHandle.set(handle, candidate);
  }

  const enabledAccounts = accounts.filter((account) => account.enabled !== false);
  const withEvidence = [];
  const profileTargets = [];

  for (const account of enabledAccounts) {
    const snapshotSummary = snapshotSummariesByHandle.get(account.handle) ?? {};
    const candidate = candidateByHandle.get(account.handle);
    const fallbackEvidenceUrls = mergeUnique(
      snapshotSummary.latestVideoUrl ? [snapshotSummary.latestVideoUrl] : [],
      account.evidenceUrls ?? [],
      candidate?.evidenceUrls ?? [],
    );
    const target = {
      id: account.id,
      handle: account.handle,
      profileUrl: account.profileUrl,
      latestCollectedAt: snapshotSummary.latestCollectedAt ?? null,
      latestPublishedAt: snapshotSummary.latestPublishedAt ?? null,
      evidenceUrls: fallbackEvidenceUrls
    };
    for (const videoUrl of target.evidenceUrls) {
      if (videoTargetsByUrl.has(videoUrl)) continue;
      videoTargetsByUrl.set(videoUrl, {
        id: buildVideoTargetId(account.handle, videoUrl),
        accountHandle: account.handle,
        videoUrl,
        enabled: true,
        latestCollectedAt: target.latestCollectedAt,
        latestPublishedAt: target.latestPublishedAt
      });
    }
    if (!target.profileUrl) continue;
    profileTargets.push({
      id: account.id,
      handle: account.handle,
      profileUrl: account.profileUrl,
      enabled: true,
      latestCollectedAt: target.latestCollectedAt,
      latestPublishedAt: target.latestPublishedAt,
      hasEvidence: target.evidenceUrls.length > 0
    });
  }

  withEvidence.push(...videoTargetsByUrl.values());
  withEvidence.sort(compareVideoTargetsByRecency);
  profileTargets.sort(compareAccountTargetsByDiscoveryStaleness);

  return {
    createdAt: new Date(now).toISOString(),
    counts: {
      accounts: enabledAccounts.length,
      videoTargets: withEvidence.length,
      accountTargets: profileTargets.length
    },
    videoTargets: withEvidence,
    accountTargets: profileTargets
  };
}

function buildWhitelistCollectionPlan({
  accounts = [],
  snapshots = [],
  now = new Date(),
  recentVideoDays = DEFAULT_RECENT_VIDEO_DAYS,
  excludeVideosCollectedSince
}) {
  const activeAccounts = accounts.filter((account) => account.enabled !== false && account.skipTracking !== true);
  const activeHandles = new Set(activeAccounts.map((account) => String(account.handle ?? "").trim()).filter(Boolean));
  const latestSnapshotsByVideoUrl = latestSnapshotByVideoUrl(
    snapshots.filter((snapshot) => activeHandles.has(String(snapshot.accountHandle ?? "").trim()))
  );
  const snapshotSummariesByHandle = summarizeSnapshotsByHandle(snapshots);
  const snapshotVideoTargets = summarizeSnapshotVideoTargets(
    snapshots.filter((snapshot) => activeHandles.has(String(snapshot.accountHandle ?? "").trim())),
    { now, recentVideoDays, excludeVideosCollectedSince }
  );
  const accountTargets = activeAccounts
    .filter((account) => account.profileUrl)
    .map((account) => {
      const summary = snapshotSummariesByHandle.get(account.handle) ?? {};
      const knownVideos = snapshotVideoTargets
        .filter((target) => String(target.accountHandle ?? "").trim() === String(account.handle ?? "").trim())
        .map((target) => {
          const latest = latestSnapshotsByVideoUrl.get(target.videoUrl) ?? {};
          return {
            videoUrl: target.videoUrl,
            latestCollectedAt: target.latestCollectedAt ?? null,
            latestPublishedAt: target.latestPublishedAt ?? null,
            views: Number(latest.views ?? 0),
            likes: Number(latest.likes ?? 0),
            comments: Number(latest.comments ?? 0),
            shares: Number(latest.shares ?? 0),
            caption: latest.caption ?? "",
            postedAt: latest.postedAt ?? target.latestPublishedAt ?? null,
            productRefs: Array.isArray(latest.productRefs) ? latest.productRefs : []
          };
        });
      return {
        id: account.id,
        handle: account.handle,
        profileUrl: account.profileUrl,
        latestCollectedAt: summary.latestCollectedAt ?? null,
        latestPublishedAt: summary.latestPublishedAt ?? null,
        sourceTables: [...(account.sourceTables ?? [])],
        materialTypes: [...(account.materialTypes ?? [])],
        remark: account.remark ?? "",
        knownVideos
      };
    })
    .sort(compareAccountTargetsByDiscoveryStaleness);

  return {
    createdAt: new Date(now).toISOString(),
    counts: {
      accounts: activeAccounts.length,
      videoTargets: snapshotVideoTargets.length,
      accountTargets: accountTargets.length
    },
    videoTargets: snapshotVideoTargets,
    accountTargets
  };
}

function compareVideoTargetsByRecency(left, right) {
  const leftCovered = Boolean(left.latestCollectedAt);
  const rightCovered = Boolean(right.latestCollectedAt);
  if (leftCovered !== rightCovered) return leftCovered ? 1 : -1;
  const leftPublished = safeDateValue(left.latestPublishedAt);
  const rightPublished = safeDateValue(right.latestPublishedAt);
  if (leftPublished !== rightPublished) {
    return rightPublished - leftPublished;
  }
  return (
    safeDateValue(left.latestCollectedAt) - safeDateValue(right.latestCollectedAt) ||
    String(left.accountHandle ?? left.handle).localeCompare(String(right.accountHandle ?? right.handle))
  );
}

function compareAccountTargetsByDiscoveryStaleness(left, right) {
  if (Boolean(left.hasEvidence) !== Boolean(right.hasEvidence)) {
    return left.hasEvidence ? 1 : -1;
  }
  const leftPublished = safeDateValue(left.latestPublishedAt);
  const rightPublished = safeDateValue(right.latestPublishedAt);
  if (leftPublished !== rightPublished) {
    return leftPublished - rightPublished;
  }
  const leftCollected = safeDateValue(left.latestCollectedAt);
  const rightCollected = safeDateValue(right.latestCollectedAt);
  if (leftCollected !== rightCollected) {
    return leftCollected - rightCollected;
  }
  return String(left.handle).localeCompare(String(right.handle));
}

function createInitialCursor(plan) {
  return {
    planCreatedAt: plan.createdAt,
    videoIndex: 0,
    accountIndex: 0,
    completed: false
  };
}

function resolveStatePath(dataDir, fileName) {
  return path.join(dataDir, "state", fileName);
}

function mergeUnique(...collections) {
  return [
    ...new Set(
      collections
        .flat()
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter((value) => value && isCanonicalTikTokVideoUrl(value))
    )
  ];
}

function summarizeSnapshotVideoTargets(snapshots, { now, recentVideoDays, excludeVideosCollectedSince } = {}) {
  const byUrl = new Map();
  for (const snapshot of snapshots) {
    const videoUrl = String(snapshot.videoUrl ?? "").trim();
    if (!videoUrl || !isCanonicalTikTokVideoUrl(videoUrl)) continue;
    if (!isRecentVideoSnapshot(snapshot, { now, recentVideoDays })) continue;
    const current = byUrl.get(videoUrl) ?? {
      id: buildVideoTargetId(snapshot.accountHandle, videoUrl),
      accountHandle: snapshot.accountHandle,
      videoUrl,
      enabled: true,
      latestCollectedAt: null,
      latestPublishedAt: null,
      views: undefined,
      likes: undefined,
      comments: undefined,
      shares: undefined,
      caption: "",
      productRefs: []
    };
    const collectedAt = snapshot.collectedAt ?? null;
    const postedAt = snapshot.postedAt ?? null;
    if (safeDateValue(collectedAt) > safeDateValue(current.latestCollectedAt)) {
      current.latestCollectedAt = collectedAt;
      current.views = Number(snapshot.views ?? current.views ?? 0);
      current.likes = Number(snapshot.likes ?? current.likes ?? 0);
      current.comments = Number(snapshot.comments ?? current.comments ?? 0);
      current.shares = Number(snapshot.shares ?? current.shares ?? 0);
      current.caption = snapshot.caption ?? current.caption ?? "";
      current.productRefs = Array.isArray(snapshot.productRefs) ? snapshot.productRefs : current.productRefs ?? [];
    }
    if (safeDateValue(postedAt) > safeDateValue(current.latestPublishedAt)) {
      current.latestPublishedAt = postedAt;
    }
    if (!current.accountHandle && snapshot.accountHandle) {
      current.accountHandle = snapshot.accountHandle;
    }
    byUrl.set(videoUrl, current);
  }
  return [...byUrl.values()].filter((target) => {
    if (!excludeVideosCollectedSince) return true;
    return safeDateValue(target.latestCollectedAt) <= safeDateValue(excludeVideosCollectedSince);
  });
}

function isRecentVideoSnapshot(snapshot, { now, recentVideoDays }) {
  const postedValue = safeDateValue(snapshot.postedAt);
  if (!postedValue) return true;
  const windowMs = Number(recentVideoDays) * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return true;
  return postedValue >= safeDateValue(now) - windowMs;
}

function buildVideoTargetId(handle, videoUrl) {
  return `video-${slugify(handle || videoUrl)}-${slugify(lastPathSegment(videoUrl))}`;
}

function lastPathSegment(value) {
  return String(value ?? "").split("/").filter(Boolean).at(-1) ?? "video";
}

function slugify(value) {
  return String(value ?? "video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "video";
}

function summarizeSnapshotsByHandle(snapshots) {
  const byHandle = new Map();
  for (const snapshot of snapshots) {
    const handle = String(snapshot.accountHandle ?? "").trim();
    if (!handle) continue;
    const current = byHandle.get(handle) ?? {
      latestCollectedAt: null,
      latestVideoUrl: null,
      latestPublishedAt: null
    };
    const collectedValue = safeDateValue(snapshot.collectedAt);
    if (collectedValue > safeDateValue(current.latestCollectedAt)) {
      current.latestCollectedAt = snapshot.collectedAt ?? current.latestCollectedAt;
      current.latestVideoUrl = snapshot.videoUrl ?? current.latestVideoUrl;
    }
    const publishedValue = safeDateValue(snapshot.postedAt);
    if (publishedValue > safeDateValue(current.latestPublishedAt)) {
      current.latestPublishedAt = snapshot.postedAt ?? current.latestPublishedAt;
    }
    byHandle.set(handle, current);
  }
  return byHandle;
}

function latestSnapshotByVideoUrl(snapshots) {
  const byUrl = new Map();
  for (const snapshot of snapshots) {
    const videoUrl = String(snapshot.videoUrl ?? "").trim();
    if (!videoUrl) continue;
    const current = byUrl.get(videoUrl);
    if (!current || safeDateValue(snapshot.collectedAt) >= safeDateValue(current.collectedAt)) {
      byUrl.set(videoUrl, snapshot);
    }
  }
  return byUrl;
}

function safeDateValue(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
