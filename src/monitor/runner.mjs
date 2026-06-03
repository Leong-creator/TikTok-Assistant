import path from "node:path";

import { createAlertRecord, buildFeishuAlertText, createFeishuNotifier, dedupeAlertSignals } from "./alerts.mjs";
import { analyzeProductSnapshots, analyzeVideoSnapshots, selectCollectionTargets } from "./analyzer.mjs";
import { collectChromeSnapshots } from "./chrome-source.mjs";
import { collectCloakBrowserSnapshots } from "./cloakbrowser-source.mjs";
import { collectCoBrowserSnapshots } from "./cobrowser-source.mjs";
import { collectMockSnapshots } from "./mock-source.mjs";
import { collectPlaywrightPersistentSnapshots } from "./playwright-persistent-source.mjs";
import {
  appendJsonLines,
  ensureMonitorDataDirs,
  readJsonFile,
  readJsonLines,
  writeJsonFile
} from "./storage.mjs";
import { isCanonicalTikTokVideoUrl } from "./video-time.mjs";
import { isWhitelistSourceConfigured, loadWhitelistAccounts } from "./whitelist-accounts.mjs";

export async function runMonitorOnce({
  dataDir = "monitoring_data",
  source = "mock",
  targets = ["accounts", "shops"],
  now = new Date(),
  browserClient,
  notifier,
  alertMode = "dm",
  alertRecipient,
  config = {},
  whitelistAccounts
} = {}) {
  await ensureMonitorDataDirs(dataDir);

  const collection = await collectMonitorSnapshots({
    dataDir,
    source,
    targets,
    now,
    browserClient,
    config,
    whitelistAccounts
  });

  const analysis = await analyzeMonitorData({
    dataDir,
    now,
    config,
    whitelistAccounts
  });

  const alerts = await sendMonitorAlerts({
    dataDir,
    now,
    notifier,
    alertMode,
    alertRecipient
  });

  return {
    source: collection.source,
    snapshots: collection.snapshots,
    failures: collection.failures,
    staleAccounts: collection.staleAccounts,
    signals: analysis.signals,
    alerts
  };
}

export async function collectMonitorSnapshots({
  dataDir = "monitoring_data",
  source = "mock",
  targets = ["accounts", "shops"],
  now = new Date(),
  browserClient,
  config = {},
  whitelistAccounts
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const resolvedWhitelistAccounts = whitelistAccounts ?? config.whitelistAccounts ?? (await loadWhitelistAccounts({ dataDir }));
  const hasWhitelist = Array.isArray(whitelistAccounts)
    ? true
    : config.whitelistAccounts
      ? true
      : await isWhitelistSourceConfigured({ dataDir });
  const seeds = await readSeeds(dataDir);
  const selected = hasWhitelist
    ? {
        accounts: resolvedWhitelistAccounts.filter((account) => account.enabled !== false && account.skipTracking !== true),
        staleAccounts: [],
        shops: targets.includes("shops") ? seeds.shops.filter((item) => item.enabled !== false) : []
      }
    : selectCollectionTargets({
        now,
        staleAccountDays: Number(config.staleAccountDays ?? 60),
        accounts: targets.includes("accounts") ? seeds.accounts : [],
        shops: targets.includes("shops") ? seeds.shops : []
      });
  const selectedAccounts = limitItems(selected.accounts, config.maxAccounts);
  const selectedShops = limitItems(selected.shops, config.maxShops);
  const selectedVideos = limitItems(
    targets.includes("videos")
      ? hasWhitelist
        ? await readWhitelistTrackedVideos({ dataDir, handles: selectedAccounts.map((account) => account.handle), now })
        : seeds.videos
      : [],
    config.maxSeedVideos
  );

  const collection = await collectSnapshots({
    source,
    now,
    browserClient,
    maxTabs: Number(config.maxTabs ?? 2),
    config,
    accounts: selectedAccounts,
    shops: selectedShops,
    videos: selectedVideos
  });

  await persistCollectedSnapshots({
    dataDir,
    collection,
    now
  });

  return {
    source: collection.source,
    collectedAt: collection.collectedAt,
    snapshots: {
      video: collection.videoSnapshots.length,
      product: collection.productSnapshots.length
    },
    failures: collection.failures,
    staleAccounts: selected.staleAccounts.length,
    selected: {
      accounts: selectedAccounts.length,
      shops: selectedShops.length,
      videos: selectedVideos.length
    }
  };
}

export async function persistCollectedSnapshots({
  dataDir = "monitoring_data",
  collection,
  now = new Date()
} = {}) {
  const videoSnapshotPath = path.join(dataDir, "snapshots", "video_snapshots.jsonl");
  const productSnapshotPath = path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl");
  await appendJsonLines(videoSnapshotPath, collection.videoSnapshots);
  await appendJsonLines(productSnapshotPath, collection.productSnapshots);
  await backfillAccountsFromVideoSnapshots({
    dataDir,
    videoSnapshots: collection.videoSnapshots,
    now
  });
  await backfillShopsFromVideoSnapshots({
    dataDir,
    videoSnapshots: collection.videoSnapshots,
    now
  });
}

function limitItems(items, limit) {
  const number = Number(limit);
  if (!Number.isFinite(number) || number <= 0) return items;
  return items.slice(0, Math.floor(number));
}

export async function analyzeMonitorData({
  dataDir = "monitoring_data",
  now = new Date(),
  config = {},
  whitelistAccounts
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const resolvedWhitelistAccounts = whitelistAccounts ?? config.whitelistAccounts ?? (await loadWhitelistAccounts({ dataDir }));
  const whitelistConfigured = Array.isArray(whitelistAccounts)
    ? true
    : config.whitelistAccounts
      ? true
      : await isWhitelistSourceConfigured({ dataDir });
  const trackedHandles = new Set(
    resolvedWhitelistAccounts
      .filter((account) => account.enabled !== false && account.skipTracking !== true)
      .map((account) => String(account.handle ?? "").trim())
      .filter(Boolean)
  );
  const whitelistMode = whitelistConfigured;
  const videoSnapshotPath = path.join(dataDir, "snapshots", "video_snapshots.jsonl");
  const productSnapshotPath = path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl");
  const allVideoSnapshots = (await readJsonLines(videoSnapshotPath))
    .filter((snapshot) => isCanonicalTikTokVideoUrl(snapshot?.videoUrl ?? ""))
    .filter((snapshot) =>
      !whitelistMode || trackedHandles.has(String(snapshot.accountHandle ?? "").trim())
    );
  const allProductSnapshots = whitelistMode ? [] : await readJsonLines(productSnapshotPath);
  const signals = [
    ...analyzeVideoSnapshots(allVideoSnapshots, {
      now,
      min3hViews: Number(config.min3hViews ?? 3000),
      min6hViews: Number(config.min6hViews ?? 3000),
      min24hViews: Number(config.min24hViews ?? 10000),
      min3hLikes: Number(config.min3hLikes ?? 3000),
      min3hShares: Number(config.min3hShares ?? 500),
      min3hComments: Number(config.min3hComments ?? 100)
    }),
    ...analyzeProductSnapshots(allProductSnapshots, { now })
  ];
  await appendJsonLines(path.join(dataDir, "signals", "signals.jsonl"), signals);
  await writeLeads(dataDir, signals, now);

  return {
    signals: signals.length
  };
}

export async function sendMonitorAlerts({
  dataDir = "monitoring_data",
  now = new Date(),
  notifier,
  alertMode = "dm",
  alertRecipient
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const signals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const previousAlerts = await readJsonLines(path.join(dataDir, "alerts", "alerts.jsonl"));
  const { toSend, skipped } = dedupeAlertSignals({ signals, previousAlerts, now });
  const sender = notifier ?? createFeishuNotifier({
    mode: alertMode,
    dmOpenId: alertMode === "dm" ? alertRecipient : undefined,
    chatId: alertMode === "chat" ? alertRecipient : undefined
  });
  const alertRecords = [];
  for (const signal of toSend) {
    const channel = alertMode === "chat" ? "feishu-chat" : "feishu-dm";
    const alert = {
      channel,
      recipient: alertRecipient,
      text: buildFeishuAlertText(signal),
      signal
    };
    const result = await sender.send(alert);
    alertRecords.push(createAlertRecord({ signal, channel, recipient: alertRecipient, result, now }));
  }
  await appendJsonLines(path.join(dataDir, "alerts", "alerts.jsonl"), alertRecords);

  return {
    sent: alertRecords.filter((alert) => alert.status === "sent").length,
    skipped: skipped.length,
    failed: alertRecords.filter((alert) => alert.status !== "sent").length
  };
}

async function backfillAccountsFromVideoSnapshots({ dataDir, videoSnapshots, now }) {
  const discovered = videoSnapshots
    .map((snapshot) => String(snapshot.accountHandle ?? "").trim())
    .filter(Boolean);
  if (!discovered.length) return;

  const accountsPath = path.join(dataDir, "seeds", "accounts.json");
  const existing = await readJsonFile(accountsPath, []);
  const byHandle = new Map(existing.map((account) => [account.handle, account]));
  const lastDiscoveredAt = new Date(now).toISOString();
  const snapshotSummaryByHandle = summarizeAccountSnapshots(videoSnapshots);

  for (const handle of new Set(discovered)) {
    const current = byHandle.get(handle) ?? {};
    const summary = snapshotSummaryByHandle.get(handle) ?? {};
    byHandle.set(handle, {
      id: current.id ?? `account-${slugify(handle)}`,
      ...current,
      handle,
      profileUrl: current.profileUrl ?? `https://www.tiktok.com/@${handle}`,
      enabled: current.enabled ?? true,
      evidenceUrls: mergeRecentVideoUrls(current.evidenceUrls ?? [], summary.videoUrls ?? []),
      latestCollectedAt: latestTimestamp(current.latestCollectedAt, summary.latestCollectedAt),
      latestPublishedAt: latestTimestamp(current.latestPublishedAt, summary.latestPublishedAt),
      discoveredFrom: current.discoveredFrom ?? "video",
      lastDiscoveredAt
    });
  }

  await writeJsonFile(accountsPath, [...byHandle.values()]);
}

function summarizeAccountSnapshots(videoSnapshots = []) {
  const byHandle = new Map();
  for (const snapshot of videoSnapshots) {
    const handle = String(snapshot.accountHandle ?? "").trim();
    if (!handle) continue;
    const current = byHandle.get(handle) ?? {
      latestCollectedAt: null,
      latestPublishedAt: null,
      videoUrls: []
    };
    current.latestCollectedAt = latestTimestamp(current.latestCollectedAt, snapshot.collectedAt);
    current.latestPublishedAt = latestTimestamp(current.latestPublishedAt, snapshot.postedAt);
    if (snapshot.videoUrl) {
      current.videoUrls.push({
        videoUrl: snapshot.videoUrl,
        postedAt: snapshot.postedAt ?? null,
        collectedAt: snapshot.collectedAt ?? null
      });
    }
    byHandle.set(handle, current);
  }
  return byHandle;
}

function mergeRecentVideoUrls(existingUrls = [], discoveredUrls = [], limit = 24) {
  const ranked = [
    ...discoveredUrls,
    ...existingUrls.map((videoUrl) => ({ videoUrl, postedAt: null, collectedAt: null }))
  ]
    .filter((item) => item?.videoUrl)
    .sort((left, right) => {
      const rightRank = latestTimestamp(right.postedAt, right.collectedAt) ?? "";
      const leftRank = latestTimestamp(left.postedAt, left.collectedAt) ?? "";
      return rightRank.localeCompare(leftRank);
    });
  return [...new Set(ranked.map((item) => item.videoUrl))].slice(0, limit);
}

function latestTimestamp(...values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return values.find(Boolean) ?? null;
  return new Date(Math.max(...timestamps)).toISOString();
}

async function backfillShopsFromVideoSnapshots({ dataDir, videoSnapshots, now }) {
  const productRefs = videoSnapshots.flatMap((snapshot) => snapshot.productRefs ?? []);
  const shopRefs = productRefs
    .map((ref) => normalizeProductRef(ref))
    .filter((ref) => ref.shopUrl || ref.productUrl);
  if (!shopRefs.length) return;

  const shopsPath = path.join(dataDir, "seeds", "shops.json");
  const existing = await readJsonFile(shopsPath, []);
  const byKey = new Map(existing.map((shop) => [shop.shopUrl || shop.productUrl, shop]));
  const lastDiscoveredAt = new Date(now).toISOString();

  for (const ref of shopRefs) {
    const key = ref.shopUrl || ref.productUrl;
    const current = byKey.get(key) ?? {};
    byKey.set(key, {
      id: current.id ?? `shop-${slugify(key)}`,
      name: current.name ?? ref.shopName ?? titleFromUrl(key),
      shopUrl: ref.shopUrl ?? current.shopUrl ?? key,
      productUrl: ref.productUrl ?? current.productUrl,
      enabled: current.enabled ?? true,
      ...current,
      discoveredFrom: current.discoveredFrom ?? "video_product_ref",
      lastDiscoveredAt
    });
  }

  await writeJsonFile(shopsPath, [...byKey.values()]);
}

function normalizeProductRef(ref) {
  if (typeof ref === "string") {
    return /\/shop\/(?:p|product|pdp)\//iu.test(ref)
      ? { productUrl: ref }
      : { shopUrl: ref };
  }
  return ref ?? {};
}

async function readSeeds(dataDir) {
  const accounts = await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const shops = await readJsonFile(path.join(dataDir, "seeds", "shops.json"), []);
  const videos = await readJsonFile(path.join(dataDir, "seeds", "videos.json"), []);
  return { accounts, shops, videos };
}

async function readWhitelistTrackedVideos({ dataDir, handles = [], now = new Date() }) {
  const handleSet = new Set(handles.map((handle) => String(handle ?? "").trim()).filter(Boolean));
  if (!handleSet.size) return [];
  const cutoff = new Date(now).getTime() - 90 * 24 * 60 * 60 * 1000;
  const snapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const latestByVideoUrl = new Map();

  for (const snapshot of snapshots) {
    const handle = String(snapshot.accountHandle ?? "").trim();
    const videoUrl = String(snapshot.videoUrl ?? "").trim();
    if (!handleSet.has(handle) || !videoUrl || !isCanonicalTikTokVideoUrl(videoUrl)) continue;
    const postedAt = snapshot.postedAt ? new Date(snapshot.postedAt).getTime() : Number.NaN;
    if (!Number.isFinite(postedAt) || postedAt < cutoff) continue;
    const current = latestByVideoUrl.get(videoUrl);
    const collectedAt = snapshot.collectedAt ? new Date(snapshot.collectedAt).getTime() : 0;
    const currentCollectedAt = current?.collectedAt ? new Date(current.collectedAt).getTime() : -1;
    if (!current || collectedAt >= currentCollectedAt) {
      latestByVideoUrl.set(videoUrl, {
        id: `video-${slugify(videoUrl)}`,
        accountHandle: handle,
        videoUrl,
        postedAt: snapshot.postedAt,
        enabled: true,
        collectedAt: snapshot.collectedAt
      });
    }
  }

  return [...latestByVideoUrl.values()]
    .sort((left, right) => new Date(right.postedAt).getTime() - new Date(left.postedAt).getTime())
    .map(({ collectedAt, ...video }) => video);
}

async function collectSnapshots(options) {
  if (options.source === "chrome") {
    return collectChromeSnapshots(options);
  }
  if (options.source === "playwright-persistent") {
    return (options.config?.collectPlaywrightPersistentSnapshots ?? collectPlaywrightPersistentSnapshots)(options);
  }
  if (options.source === "cloakbrowser") {
    return (options.config?.collectCloakBrowserSnapshots ?? collectCloakBrowserSnapshots)(options);
  }
  if (options.source === "cobrowser") {
    return (options.config?.collectCoBrowserSnapshots ?? collectCoBrowserSnapshots)(options);
  }
  if (options.source === "mock") {
    return collectMockSnapshots(options);
  }
  throw new Error(`unsupported monitor source: ${options.source}`);
}

async function writeLeads(dataDir, signals, now) {
  const leadSignals = signals.filter((signal) => signal.entityType === "video" && signal.leadEligible !== false);
  for (const signal of leadSignals) {
    const slug = `${formatLocalDate(new Date(now))}-${slugify(signal.accountHandle ?? "video")}-${slugify(lastPathSegment(signal.entityUrl))}`;
    await writeJsonFile(path.join(dataDir, "leads", slug, "source.json"), {
      source: "tiktok-monitor",
      createdAt: new Date(now).toISOString(),
      signal
    });
  }
}

function lastPathSegment(value) {
  return String(value ?? "lead").split("/").filter(Boolean).at(-1) ?? "lead";
}

function slugify(value) {
  return String(value ?? "lead")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "lead";
}

function titleFromUrl(value) {
  return String(value ?? "TikTok Shop").split("/").filter(Boolean).at(-1)?.replace(/[-_]+/gu, " ") ?? "TikTok Shop";
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
