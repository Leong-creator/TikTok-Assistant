import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectChromeSnapshots } from "./chrome-source.mjs";
import { ensureSeededProfile } from "./playwright-persistent-runtime.mjs";

export async function collectCloakBrowserSnapshots({
  now = new Date(),
  maxTabs = 1,
  accounts = [],
  shops = [],
  videos = [],
  config = {}
} = {}) {
  const launchPersistentContext =
    config.launchCloakBrowserPersistentContext ?? (await loadCloakBrowserLaunchPersistentContext(config.cloakbrowserRuntimeModule));
  const createBrowserClient =
    config.createPlaywrightBrowserClient ?? (await loadCreatePlaywrightBrowserClient());
  const collectSnapshots = config.collectChromeSnapshots ?? collectChromeSnapshots;
  const profiles = resolveCloakBrowserProfiles(config);

  if (config.cloakbrowserFresh ?? true) {
    fs.rmSync(profiles.runProfileDir, { recursive: true, force: true });
  }
  ensureSeededProfile({
    profileDir: profiles.runProfileDir,
    seedProfileDir: profiles.seedProfileDir,
    sourceProfileDir: profiles.sourceProfileDir
  });

  const context = await launchPersistentContext({
    userDataDir: profiles.runProfileDir,
    headless: config.cloakbrowserHeadless === false ? false : true,
    humanize: Boolean(config.cloakbrowserHumanize ?? true),
    humanPreset: config.cloakbrowserHumanPreset ?? "careful",
    proxy: config.cloakbrowserProxy,
    timezone: config.cloakbrowserTimezone,
    locale: config.cloakbrowserLocale,
    args: config.cloakbrowserArgs,
    stealthArgs: config.cloakbrowserStealthArgs,
    launchOptions: config.cloakbrowserLaunchOptions
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
      snapshotRetryDelayMs: numberOrDefault(config.snapshotRetryDelayMs, 1_000),
      humanize: Boolean(config.cloakbrowserHumanize ?? true),
      humanPreset: config.cloakbrowserHumanPreset ?? "careful",
      postNavigateDelayMinMs: numberOrDefault(config.cloakbrowserPostNavigateDelayMinMs, 1200),
      postNavigateDelayMaxMs: numberOrDefault(config.cloakbrowserPostNavigateDelayMaxMs, 2600),
      preSnapshotDelayMinMs: numberOrDefault(config.cloakbrowserPreSnapshotDelayMinMs, 900),
      preSnapshotDelayMaxMs: numberOrDefault(config.cloakbrowserPreSnapshotDelayMaxMs, 1800),
      preSnapshotScrollMinY: numberOrDefault(config.cloakbrowserPreSnapshotScrollMinY, 240),
      preSnapshotScrollMaxY: numberOrDefault(config.cloakbrowserPreSnapshotScrollMaxY, 720)
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
      source: "cloakbrowser",
      videoSnapshots: collection.videoSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "cloakbrowser"
      })),
      productSnapshots: collection.productSnapshots.map((snapshot) => ({
        ...snapshot,
        source: "cloakbrowser"
      }))
    };
  } finally {
    await context?.close?.();
  }
}

export function resolveCloakBrowserProfiles(config = {}) {
  return {
    runProfileDir: path.resolve(
      config.cloakbrowserProfileDir ?? config.playwrightProfileDir ?? ".runtime/browser/tiktok-monitor-run-profile-headless-cloak"
    ),
    sourceProfileDir: config.cloakbrowserSourceProfileDir
      ? path.resolve(config.cloakbrowserSourceProfileDir)
      : undefined,
    seedProfileDir: config.cloakbrowserSeedProfileDir
      ? path.resolve(config.cloakbrowserSeedProfileDir)
      : undefined
  };
}

async function loadCreatePlaywrightBrowserClient() {
  return loadNamedExport(
    "./playwright-browser-client.mjs",
    "createPlaywrightBrowserClient",
    "Playwright browser client module is not available. Add src/monitor/playwright-browser-client.mjs or inject config.createPlaywrightBrowserClient."
  );
}

async function loadCloakBrowserLaunchPersistentContext(explicitModulePath) {
  const runtimeModulePath = resolveCloakBrowserRuntimeModule(explicitModulePath);
  return loadNamedExport(
    runtimeModulePath,
    "launchPersistentContext",
    "CloakBrowser runtime is not available. Install cloakbrowser or inject config.launchCloakBrowserPersistentContext."
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

function resolveCloakBrowserRuntimeModule(explicitModulePath) {
  const candidates = [];
  if (explicitModulePath) candidates.push(explicitModulePath);

  const homeDir = os.homedir();
  candidates.push(path.join(homeDir, "plugins", "cloakbrowser", "node_modules", "cloakbrowser"));

  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache", "local-codex-plugins", "cloakbrowser");
  if (fs.existsSync(cacheRoot)) {
    for (const version of fs.readdirSync(cacheRoot)) {
      candidates.push(path.join(cacheRoot, version, "node_modules", "cloakbrowser"));
    }
  }
  candidates.push("cloakbrowser");

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate)) return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No CloakBrowser runtime module found. Tried: ${candidates.join(" | ")}`);
}

function pathToFileUrlIfNeeded(modulePath) {
  if (!path.isAbsolute(modulePath)) return modulePath;
  const normalized = modulePath.replace(/\\/gu, "/");
  return normalized.startsWith("file://") ? normalized : `file:///${normalized}`;
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function formatLoadError(error) {
  return error instanceof Error ? error.message : String(error);
}
