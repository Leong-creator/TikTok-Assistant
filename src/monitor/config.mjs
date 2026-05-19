import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveMonitorConfig(env = process.env) {
  const persistentBrowserRoot = env.TIKTOK_PERSISTENT_BROWSER_ROOT_DIR ?? defaultPersistentBrowserRoot({ env });
  const usingLocalRuntimeRoot = isLocalMonitorRuntimeRoot(persistentBrowserRoot);
  const usingCoBrowserRoot = isCoBrowserRoot(persistentBrowserRoot, { env });
  return {
    dataDir: env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data",
    source: env.TIKTOK_MONITOR_SOURCE ?? "cloakbrowser",
    targets: parseTargets(env.TIKTOK_MONITOR_TARGETS ?? "accounts,shops,videos"),
    maxTabs: Number(env.TIKTOK_CHROME_MAX_TABS ?? 1),
    collectionIntervalHours: Number(env.TIKTOK_MONITOR_COLLECTION_INTERVAL_HOURS ?? 3),
    maxVideosPerAccount: Number(env.TIKTOK_CHROME_MAX_VIDEOS_PER_ACCOUNT ?? 60),
    maxProductsPerShop: Number(env.TIKTOK_CHROME_MAX_PRODUCTS_PER_SHOP ?? 6),
    persistentBrowserRoot,
    playwrightProfileDir:
      env.TIKTOK_PLAYWRIGHT_RUN_PROFILE_DIR ??
      env.TIKTOK_PLAYWRIGHT_PROFILE_DIR ??
      defaultRunProfileDir(persistentBrowserRoot, "tiktok-monitor-run-profile-headless", { usingCoBrowserRoot }),
    playwrightSourceProfileDir:
      env.TIKTOK_SHARED_SOURCE_PROFILE_DIR ??
      env.TIKTOK_PLAYWRIGHT_SOURCE_PROFILE_DIR ??
      defaultSourceProfileDir(persistentBrowserRoot, { usingCoBrowserRoot, usingLocalRuntimeRoot }),
    playwrightSeedProfileDir: env.TIKTOK_PLAYWRIGHT_SEED_PROFILE_DIR,
    chatgptPlaywrightRunProfileDir:
      env.CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR ??
      defaultRunProfileDir(persistentBrowserRoot, "chatgpt-web-run-profile-headed", { usingCoBrowserRoot }),
    playwrightHeadless: parseBoolean(env.TIKTOK_PLAYWRIGHT_HEADLESS, true),
    playwrightChannel: env.TIKTOK_PLAYWRIGHT_CHANNEL ?? "chrome",
    publicFirst: parseBoolean(env.TIKTOK_CHROME_PUBLIC_FIRST, true),
    requireLoginOnBlock: parseBoolean(env.TIKTOK_REQUIRE_LOGIN_ON_BLOCK, true),
    staleAccountDays: Number(env.TIKTOK_STALE_ACCOUNT_DAYS ?? 60),
    min3hViews: Number(env.TIKTOK_ALERT_MIN_3H_VIEWS ?? 3000),
    min6hViews: Number(env.TIKTOK_ALERT_MIN_6H_VIEWS ?? 3000),
    min24hViews: Number(env.TIKTOK_ALERT_MIN_24H_VIEWS ?? 10000),
    min3hLikes: Number(env.TIKTOK_ALERT_MIN_3H_LIKES ?? 3000),
    min3hShares: Number(env.TIKTOK_ALERT_MIN_3H_SHARES ?? 500),
    min3hComments: Number(env.TIKTOK_ALERT_MIN_3H_COMMENTS ?? 100),
    feishuAlertMode: env.FEISHU_ALERT_MODE ?? "dm",
    feishuDmOpenId: env.FEISHU_DM_OPEN_ID,
    feishuAlertChatId: env.FEISHU_ALERT_CHAT_ID,
    feishuBaseToken: env.FEISHU_BASE_TOKEN,
    cobrowserRoot: env.COBROWSER_ROOT_DIR,
    cobrowserRuntimeModule: env.COBROWSER_RUNTIME_MODULE,
    cobrowserHeadless: parseBoolean(env.COBROWSER_HEADLESS, true),
    cobrowserProfile: env.COBROWSER_PROFILE,
    cobrowserFresh: parseBoolean(env.COBROWSER_FRESH, true),
    cloakbrowserProfileDir:
      env.TIKTOK_CLOAKBROWSER_RUN_PROFILE_DIR ??
      defaultRunProfileDir(persistentBrowserRoot, "tiktok-monitor-run-profile-headless-cloak", {
        usingCoBrowserRoot
      }),
    cloakbrowserRuntimeModule: env.CLOAKBROWSER_MODULE,
    cloakbrowserSourceProfileDir:
      env.TIKTOK_CLOAKBROWSER_SOURCE_PROFILE_DIR ??
      env.TIKTOK_SHARED_SOURCE_PROFILE_DIR ??
      defaultSourceProfileDir(persistentBrowserRoot, { usingCoBrowserRoot, usingLocalRuntimeRoot }),
    cloakbrowserSeedProfileDir: env.TIKTOK_CLOAKBROWSER_SEED_PROFILE_DIR,
    cloakbrowserHeadless: parseBoolean(env.TIKTOK_CLOAKBROWSER_HEADLESS, true),
    cloakbrowserFresh: parseBoolean(env.TIKTOK_CLOAKBROWSER_FRESH, true),
    cloakbrowserHumanize: parseBoolean(env.TIKTOK_CLOAKBROWSER_HUMANIZE, true),
    cloakbrowserHumanPreset: env.TIKTOK_CLOAKBROWSER_HUMAN_PRESET ?? "careful",
    cloakbrowserLocale: env.TIKTOK_CLOAKBROWSER_LOCALE,
    cloakbrowserTimezone: env.TIKTOK_CLOAKBROWSER_TIMEZONE,
    cloakbrowserProxy: env.TIKTOK_CLOAKBROWSER_PROXY,
    cloakbrowserPostNavigateDelayMinMs: Number(env.TIKTOK_CLOAKBROWSER_POST_NAVIGATE_DELAY_MIN_MS ?? 1200),
    cloakbrowserPostNavigateDelayMaxMs: Number(env.TIKTOK_CLOAKBROWSER_POST_NAVIGATE_DELAY_MAX_MS ?? 2600),
    cloakbrowserPreSnapshotDelayMinMs: Number(env.TIKTOK_CLOAKBROWSER_PRE_SNAPSHOT_DELAY_MIN_MS ?? 900),
    cloakbrowserPreSnapshotDelayMaxMs: Number(env.TIKTOK_CLOAKBROWSER_PRE_SNAPSHOT_DELAY_MAX_MS ?? 1800),
    cloakbrowserPreSnapshotScrollMinY: Number(env.TIKTOK_CLOAKBROWSER_PRE_SNAPSHOT_SCROLL_MIN_Y ?? 240),
    cloakbrowserPreSnapshotScrollMaxY: Number(env.TIKTOK_CLOAKBROWSER_PRE_SNAPSHOT_SCROLL_MAX_Y ?? 720)
  };
}

export function parseTargets(value) {
  return String(value ?? "accounts,shops")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes)$/iu.test(String(value));
}

function defaultPersistentBrowserRoot({ homeDir = os.homedir(), env = process.env } = {}) {
  const coBrowserRoot = env.COBROWSER_HOME ?? path.join(homeDir, ".codex-cobrowser");
  if (env.COBROWSER_HOME) {
    return coBrowserRoot;
  }
  if (fs.existsSync(coBrowserRoot)) {
    return coBrowserRoot;
  }

  const sharedRoot = path.join(homeDir, ".codex", "persistent-browser-profiles");
  if (fs.existsSync(sharedRoot)) {
    return sharedRoot;
  }
  return defaultLocalMonitorRuntimeRoot();
}

function defaultSourceProfileDir(rootDir, { usingCoBrowserRoot = false, usingLocalRuntimeRoot = false } = {}) {
  if (usingCoBrowserRoot) {
    return path.join(rootDir, "source-profile");
  }
  return path.join(rootDir, usingLocalRuntimeRoot ? "tiktok-monitor-profile-headed" : "shared-source-profile");
}

function defaultRunProfileDir(rootDir, runName, { usingCoBrowserRoot = false } = {}) {
  return path.join(rootDir, usingCoBrowserRoot ? "run-profiles" : "", runName);
}

function defaultLocalMonitorRuntimeRoot() {
  return path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".runtime", "browser"));
}

function isLocalMonitorRuntimeRoot(rootDir) {
  return path.resolve(rootDir) === defaultLocalMonitorRuntimeRoot();
}

function isCoBrowserRoot(rootDir, { homeDir = os.homedir(), env = process.env } = {}) {
  return path.resolve(rootDir) === path.resolve(env.COBROWSER_HOME ?? path.join(homeDir, ".codex-cobrowser"));
}
