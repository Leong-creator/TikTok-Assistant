import path from "node:path";

import { ensureMonitorDataDirs, readJsonFile, readJsonLines, writeJsonFile } from "./storage.mjs";

const PLAN_FILE = "chrome_collect_plan.json";
const CURSOR_FILE = "chrome_collect_cursor.json";

export async function createCollectionPlan({
  dataDir = "monitoring_data",
  now = new Date()
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const accounts = await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const candidates = await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []);
  const snapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const plan = buildCollectionPlan({ accounts, candidates, snapshots, now });
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

  const videoStart = Number(cursor.videoIndex ?? 0);
  const accountStart = Number(cursor.accountIndex ?? 0);
  const videos = plan.videoTargets.slice(videoStart, videoStart + maxVideoTargets);
  const accounts = videos.length
    ? []
    : plan.accountTargets.slice(accountStart, accountStart + maxAccountTargets);
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
  now = new Date()
} = {}) {
  const latestByHandle = new Map();
  for (const snapshot of snapshots) {
    const handle = String(snapshot.accountHandle ?? "").trim();
    if (!handle) continue;
    const current = latestByHandle.get(handle);
    if (!current || new Date(snapshot.collectedAt).getTime() > new Date(current.collectedAt).getTime()) {
      latestByHandle.set(handle, snapshot);
    }
  }

  const candidateByHandle = new Map();
  for (const candidate of candidates) {
    const handle = String(candidate.handle ?? "").trim();
    if (!handle) continue;
    candidateByHandle.set(handle, candidate);
  }

  const enabledAccounts = accounts.filter((account) => account.enabled !== false);
  const withEvidence = [];
  const withoutEvidence = [];

  for (const account of enabledAccounts) {
    const latestSnapshot = latestByHandle.get(account.handle);
    const candidate = candidateByHandle.get(account.handle);
    const fallbackEvidenceUrls = mergeUnique(
      account.evidenceUrls ?? [],
      candidate?.evidenceUrls ?? [],
      latestSnapshot?.videoUrl ? [latestSnapshot.videoUrl] : []
    );
    const target = {
      id: account.id,
      handle: account.handle,
      profileUrl: account.profileUrl,
      latestCollectedAt: latestSnapshot?.collectedAt ?? null,
      evidenceUrls: fallbackEvidenceUrls
    };
    if (target.evidenceUrls.length > 0) {
      withEvidence.push({
        id: `video-${account.handle}`,
        accountHandle: account.handle,
        videoUrl: target.evidenceUrls[0],
        enabled: true,
        latestCollectedAt: target.latestCollectedAt
      });
    } else {
      withoutEvidence.push({
        id: account.id,
        handle: account.handle,
        profileUrl: account.profileUrl,
        enabled: true,
        latestCollectedAt: target.latestCollectedAt
      });
    }
  }

  withEvidence.sort(compareTargetsByCoverageAndRecency);
  withoutEvidence.sort(compareTargetsByCoverageAndRecency);

  return {
    createdAt: new Date(now).toISOString(),
    counts: {
      accounts: enabledAccounts.length,
      videoTargets: withEvidence.length,
      accountTargets: withoutEvidence.length
    },
    videoTargets: withEvidence,
    accountTargets: withoutEvidence
  };
}

function compareTargetsByCoverageAndRecency(left, right) {
  const leftCovered = Boolean(left.latestCollectedAt);
  const rightCovered = Boolean(right.latestCollectedAt);
  if (leftCovered !== rightCovered) return leftCovered ? 1 : -1;
  if (!leftCovered && !rightCovered) {
    return String(left.accountHandle ?? left.handle).localeCompare(String(right.accountHandle ?? right.handle));
  }
  return (
    new Date(left.latestCollectedAt).getTime() - new Date(right.latestCollectedAt).getTime() ||
    String(left.accountHandle ?? left.handle).localeCompare(String(right.accountHandle ?? right.handle))
  );
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
  return [...new Set(collections.flat().filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}
