import { createRequire } from "node:module";

import { collectChromeSnapshots } from "./chrome-source.mjs";

const require = createRequire(import.meta.url);

export async function collectPlaywrightPersistentSnapshots({
  playwright,
  now = new Date(),
  maxTabs = 2,
  accounts = [],
  shops = [],
  videos = [],
  config = {}
} = {}) {
  const startPersistentContext =
    config.startPlaywrightPersistentContext ?? (await loadStartPlaywrightPersistentContext());
  const createBrowserClient =
    config.createPlaywrightBrowserClient ?? (await loadCreatePlaywrightBrowserClient());
  const resolvedPlaywright = playwright ?? config.playwright ?? (await loadPlaywright());
  const collectSnapshots = config.collectChromeSnapshots ?? collectChromeSnapshots;

  const context = await startPersistentContext({
    playwright: resolvedPlaywright,
    profileDir: config.playwrightProfileDir,
    sourceProfileDir: config.playwrightSourceProfileDir,
    seedProfileDir: config.playwrightSeedProfileDir,
    headless: config.playwrightHeadless,
    channel: config.playwrightChannel
  });

  try {
    const browserClient = createBrowserClient({
      context,
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
      source: "playwright-persistent",
      videoSnapshots: collection.videoSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "playwright-persistent"
      })),
      productSnapshots: collection.productSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "playwright-persistent"
      }))
    };
  } finally {
    await context?.close?.();
  }
}

async function loadCreatePlaywrightBrowserClient() {
  return loadNamedExport(
    "./playwright-browser-client.mjs",
    "createPlaywrightBrowserClient",
    "Playwright browser client module is not available. Add src/monitor/playwright-browser-client.mjs or inject config.createPlaywrightBrowserClient."
  );
}

async function loadStartPlaywrightPersistentContext() {
  return loadNamedExport(
    "./playwright-persistent-runtime.mjs",
    "startPlaywrightPersistentContext",
    "Persistent Playwright runtime module is not available. Add src/monitor/playwright-persistent-runtime.mjs or inject config.startPlaywrightPersistentContext."
  );
}

async function loadPlaywright() {
  const candidates = [
    "playwright",
    "C:/Users/EDY/node_modules/playwright",
    "C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      const playwright = require(candidate);
      if (playwright?.chromium) return playwright;
      failures.push(`${candidate}: missing chromium export`);
    } catch (error) {
      failures.push(`${candidate}: ${formatLoadError(error)}`);
    }
  }
  throw new Error(
    `Playwright is not available. Install the dependency or inject config.playwright. Tried: ${failures.join(" | ")}`
  );
}

async function loadNamedExport(modulePath, exportName, missingMessage) {
  try {
    const module = await import(modulePath);
    if (typeof module[exportName] !== "function") {
      throw new Error(`${exportName} export is missing from ${modulePath}`);
    }
    return module[exportName];
  } catch (error) {
    throw new Error(`${missingMessage} ${formatLoadError(error)}`);
  }
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function formatLoadError(error) {
  return error instanceof Error ? error.message : String(error);
}
