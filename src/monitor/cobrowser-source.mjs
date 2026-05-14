import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectChromeSnapshots } from "./chrome-source.mjs";

export async function collectCoBrowserSnapshots({
  now = new Date(),
  maxTabs = 2,
  accounts = [],
  shops = [],
  videos = [],
  config = {}
} = {}) {
  const startSession =
    config.startCoBrowserSession ?? (await loadCoBrowserStartSession(config.cobrowserRuntimeModule));
  const createBrowserClient =
    config.createPlaywrightBrowserClient ?? (await loadCreatePlaywrightBrowserClient());
  const collectSnapshots = config.collectChromeSnapshots ?? collectChromeSnapshots;

  const session = await startSession({
    mode: config.cobrowserHeadless === false ? "headed" : "headless",
    profile: config.cobrowserProfile,
    source: false,
    fresh: config.cobrowserFresh ?? true,
    acceptDownloads: false,
    width: numberOrDefault(config.cobrowserWidth, 1440),
    height: numberOrDefault(config.cobrowserHeight, 960),
    root: config.cobrowserRoot
  });

  try {
    const browserClient = createBrowserClient({
      context: session.context,
      maxVideosPerAccount: numberOrDefault(config.maxVideosPerAccount, 60),
      maxProductsPerShop: numberOrDefault(config.maxProductsPerShop, 6),
      waitUntil: config.waitUntil ?? "domcontentloaded",
      timeoutMs: numberOrDefault(config.timeoutMs, 15_000),
      snapshotTimeoutMs: numberOrDefault(config.snapshotTimeoutMs ?? config.timeoutMs, 15_000),
      closeTimeoutMs: numberOrDefault(config.closeTimeoutMs, 5_000),
      snapshotRetries: numberOrDefault(config.snapshotRetries, 8),
      snapshotRetryDelayMs: numberOrDefault(config.snapshotRetryDelayMs, 1_000)
    });

    const collection = await collectSnapshots({
      now,
      maxTabs,
      browserClient,
      accounts,
      shops,
      videos
    });

    return {
      ...collection,
      source: "cobrowser",
      videoSnapshots: collection.videoSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "cobrowser"
      })),
      productSnapshots: collection.productSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "cobrowser"
      }))
    };
  } finally {
    await session?.close?.();
  }
}

async function loadCreatePlaywrightBrowserClient() {
  return loadNamedExport(
    "./playwright-browser-client.mjs",
    "createPlaywrightBrowserClient",
    "Playwright browser client module is not available. Add src/monitor/playwright-browser-client.mjs or inject config.createPlaywrightBrowserClient."
  );
}

async function loadCoBrowserStartSession(explicitModulePath) {
  const runtimeModulePath = resolveCoBrowserRuntimeModule(explicitModulePath);
  return loadNamedExport(
    runtimeModulePath,
    "startSession",
    "CoBrowser runtime is not available. Install the CoBrowser plugin or inject config.startCoBrowserSession."
  );
}

async function loadNamedExport(modulePath, exportName, missingMessage) {
  try {
    const module = await import(pathToFileUrlIfNeeded(modulePath));
    if (typeof module[exportName] !== "function") {
      throw new Error(`${exportName} export is missing from ${modulePath}`);
    }
    return module[exportName];
  } catch (error) {
    throw new Error(`${missingMessage} ${formatLoadError(error)}`);
  }
}

function resolveCoBrowserRuntimeModule(explicitModulePath) {
  const candidates = [];
  if (explicitModulePath) candidates.push(explicitModulePath);

  const homeDir = os.homedir();
  candidates.push(path.join(homeDir, "plugins", "cobrowser", "lib", "runtime.mjs"));

  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache", "local-codex-plugins", "cobrowser");
  if (fs.existsSync(cacheRoot)) {
    for (const version of fs.readdirSync(cacheRoot)) {
      candidates.push(path.join(cacheRoot, version, "lib", "runtime.mjs"));
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No CoBrowser runtime module found. Tried: ${candidates.join(" | ")}`);
}

function pathToFileUrlIfNeeded(modulePath) {
  if (/^[a-z]+:/iu.test(modulePath)) {
    const normalized = modulePath.replace(/\\/gu, "/");
    return normalized.startsWith("file://") ? normalized : `file:///${normalized}`;
  }
  return modulePath;
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function formatLoadError(error) {
  return error instanceof Error ? error.message : String(error);
}
