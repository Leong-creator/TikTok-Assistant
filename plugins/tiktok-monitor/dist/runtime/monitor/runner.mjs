import path from "node:path";

import { createAlertRecord, buildFeishuAlertText, createFeishuNotifier, dedupeAlertSignals } from "./alerts.mjs";
import { analyzeProductSnapshots, analyzeVideoSnapshots, selectCollectionTargets } from "./analyzer.mjs";
import { collectChromeSnapshots } from "./chrome-source.mjs";
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

export async function runMonitorOnce({
  dataDir = "monitoring_data",
  source = "mock",
  targets = ["accounts", "shops"],
  now = new Date(),
  browserClient,
  notifier,
  alertMode = "dm",
  alertRecipient,
  config = {}
} = {}) {
  await ensureMonitorDataDirs(dataDir);

  const collection = await collectMonitorSnapshots({
    dataDir,
    source,
    targets,
    now,
    browserClient,
    config
  });

  const analysis = await analyzeMonitorData({
    dataDir,
    now,
    config
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
  config = {}
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const seeds = await readSeeds(dataDir);
  const selected = selectCollectionTargets({
    now,
    staleAccountDays: Number(config.staleAccountDays ?? 60),
    accounts: targets.includes("accounts") ? seeds.accounts : [],
    shops: targets.includes("shops") ? seeds.shops : []
  });
  const selectedAccounts = limitItems(selected.accounts, config.maxAccounts);
  const selectedShops = limitItems(selected.shops, config.maxShops);
  const selectedVideos = limitItems(
    targets.includes("videos") ? seeds.videos : [],
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
  config = {}
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const videoSnapshotPath = path.join(dataDir, "snapshots", "video_snapshots.jsonl");
  const productSnapshotPath = path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl");
  const allVideoSnapshots = await readJsonLines(videoSnapshotPath);
  const allProductSnapshots = await readJsonLines(productSnapshotPath);
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

  for (const handle of new Set(discovered)) {
    const current = byHandle.get(handle) ?? {};
    byHandle.set(handle, {
      id: current.id ?? `account-${slugify(handle)}`,
      handle,
      profileUrl: current.profileUrl ?? `https://www.tiktok.com/@${handle}`,
      enabled: current.enabled ?? true,
      ...current,
      discoveredFrom: current.discoveredFrom ?? "video",
      lastDiscoveredAt
    });
  }

  await writeJsonFile(accountsPath, [...byHandle.values()]);
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

async function collectSnapshots(options) {
  if (options.source === "chrome") {
    return collectChromeSnapshots(options);
  }
  if (options.source === "playwright-persistent") {
    return (options.config?.collectPlaywrightPersistentSnapshots ?? collectPlaywrightPersistentSnapshots)(options);
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
  const leadSignals = signals.filter((signal) => signal.entityType === "video" && signal.recommendedAction === "create_lead");
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
