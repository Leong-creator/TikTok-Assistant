import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectChromeSnapshots } from "./chrome-source.mjs";
import {
  DEFAULT_TIKTOK_DISCOVERY_QUERIES,
  discoverChromeAccountCandidates
} from "./discovery.mjs";
import { createBrightDataFallbackHooks } from "./brightdata-browser-fallback.mjs";
import { createDokobotFallbackHooks } from "./dokobot-local.mjs";
import { ensureSeededProfile } from "./playwright-persistent-runtime.mjs";

export async function collectCloakBrowserSnapshots({
  now = new Date(),
  maxTabs = 1,
  accounts = [],
  shops = [],
  videos = [],
  config = {}
} = {}) {
  return withCloakBrowserBrowserClient({
    config,
    async run(browserClient) {
      const collectSnapshots = config.collectChromeSnapshots ?? collectChromeSnapshots;
      const fallbackHooks = await resolveFallbackHooks({ config });
      const effectiveConfig = fallbackHooks
        ? {
            ...config,
            ...fallbackHooks
          }
        : config;
      const collection = await collectSnapshots({
        now,
        maxTabs,
        browserClient,
        accounts,
        shops,
        videos,
        config: effectiveConfig
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
    }
  });
}

async function resolveFallbackHooks({ config = {} } = {}) {
  const hookSets = [];

  const brightDataHooks = await resolveBrightDataFallbackHooks({ config });
  if (brightDataHooks) hookSets.push(brightDataHooks);

  const dokobotHooks = await resolveDokobotFallbackHooks({ config });
  if (dokobotHooks) hookSets.push(dokobotHooks);

  if (hookSets.length === 0) return null;

  return {
    extractProfileVideosFallback: composeFallbackChain(hookSets, "extractProfileVideosFallback"),
    extractDirectVideoFallback: composeFallbackChain(hookSets, "extractDirectVideoFallback")
  };
}

async function resolveBrightDataFallbackHooks({ config = {} } = {}) {
  if (config.brightDataFallback !== true) return null;
  const factory = config.createBrightDataFallbackHooks ?? createBrightDataFallbackHooks;
  try {
    return await factory(config);
  } catch {
    return null;
  }
}

async function resolveDokobotFallbackHooks({ config = {} } = {}) {
  if (config.dokobotFallback === false) return null;
  if (config.dokobotFallback !== true && isInjectedCloakTestConfig(config)) return null;
  const factory = config.createDokobotFallbackHooks ?? createDokobotFallbackHooks;
  try {
    return await factory(config);
  } catch {
    return null;
  }
}

function composeFallbackChain(hookSets = [], hookName) {
  const handlers = hookSets
    .map((hooks) => hooks?.[hookName])
    .filter((handler) => typeof handler === "function");

  if (handlers.length === 0) return undefined;

  return async (payload) => {
    let currentResult = payload?.primaryResult;
    for (const handler of handlers) {
      let nextResult;
      try {
        nextResult = await handler({
          ...payload,
          primaryResult: currentResult
        });
      } catch {
        continue;
      }
      if (nextResult?.status === "ok") {
        return nextResult;
      }
      currentResult = nextResult ?? currentResult;
    }
    return currentResult;
  };
}

function isInjectedCloakTestConfig(config = {}) {
  return Boolean(
    config.launchCloakBrowserPersistentContext ||
      config.createPlaywrightBrowserClient ||
      config.collectChromeSnapshots
  );
}

export async function discoverCloakBrowserAccountCandidates({
  dataDir = "monitoring_data",
  now = new Date(),
  queries = DEFAULT_TIKTOK_DISCOVERY_QUERIES,
  config = {}
} = {}) {
  return withCloakBrowserBrowserClient({
    config,
    async run(browserClient) {
      return discoverChromeAccountCandidates({
        dataDir,
        browserClient,
        queries,
        now,
        maxTabs: numberOrDefault(config.maxTabs, 1),
        queryTimeoutMs: numberOrDefault(config.queryTimeoutMs, 45_000),
        profileTimeoutMs: numberOrDefault(config.profileTimeoutMs, 15_000)
      });
    }
  });
}

async function withCloakBrowserBrowserClient({ config = {}, run }) {
  const launchPersistentContext =
    config.launchCloakBrowserPersistentContext ?? (await loadCloakBrowserLaunchPersistentContext(config.cloakbrowserRuntimeModule));
  const createBrowserClient =
    config.createPlaywrightBrowserClient ?? (await loadCreatePlaywrightBrowserClient());
  const profiles = resolveCloakBrowserProfiles(config);
  const runProfileDir = shouldUseEphemeralRunProfile(config)
    ? createEphemeralRunProfileDir(profiles.runProfileDir)
    : profiles.runProfileDir;
  const cleanupRunProfileDir = runProfileDir !== profiles.runProfileDir ? runProfileDir : null;

  if (config.cloakbrowserFresh ?? true) {
    removeDirBestEffortSync(runProfileDir);
  }
  ensureSeededProfile({
    profileDir: runProfileDir,
    seedProfileDir: profiles.seedProfileDir,
    sourceProfileDir: profiles.sourceProfileDir
  });

  const context = await launchPersistentContext({
    userDataDir: runProfileDir,
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
      maxVideosPerAccount: numberOrDefault(config.maxVideosPerAccount, 120),
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
    return await run(browserClient);
  } finally {
    await context?.close?.();
    if (cleanupRunProfileDir) {
      removeDirBestEffortSync(cleanupRunProfileDir);
    }
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
  candidates.push(path.join(homeDir, "plugins", "cloakbrowser", "node_modules", "cloakbrowser", "dist", "index.js"));

  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache", "local-codex-plugins", "cloakbrowser");
  if (fs.existsSync(cacheRoot)) {
    for (const version of fs.readdirSync(cacheRoot)) {
      candidates.push(path.join(cacheRoot, version, "node_modules", "cloakbrowser", "dist", "index.js"));
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

function shouldUseEphemeralRunProfile(config = {}) {
  return config.cloakbrowserEphemeral ?? true;
}

function createEphemeralRunProfileDir(baseDir) {
  const normalizedBase = path.resolve(baseDir);
  const parentDir = path.dirname(normalizedBase);
  const baseName = path.basename(normalizedBase);
  return path.join(parentDir, `${baseName}-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function removeDirBestEffortSync(targetDir, { retries = 6, delayMs = 250 } = {}) {
  if (!targetDir) return;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isProfileLockError(error) || attempt === retries) {
        return;
      }
      sleepSync(delayMs);
    }
  }
}

function isProfileLockError(error) {
  const code = error?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
