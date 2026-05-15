import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveMonitorConfig(env = process.env) {
  const persistentBrowserRoot = env.TIKTOK_PERSISTENT_BROWSER_ROOT_DIR ?? defaultPersistentBrowserRoot();
  const usingLocalRuntimeRoot = isLocalMonitorRuntimeRoot(persistentBrowserRoot);
  return {
    dataDir: env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data",
    source: env.TIKTOK_MONITOR_SOURCE ?? "cobrowser",
    targets: parseTargets(env.TIKTOK_MONITOR_TARGETS ?? "accounts,shops,videos"),
    maxTabs: Number(env.TIKTOK_CHROME_MAX_TABS ?? 2),
    collectionIntervalHours: Number(env.TIKTOK_MONITOR_COLLECTION_INTERVAL_HOURS ?? 3),
    maxVideosPerAccount: Number(env.TIKTOK_CHROME_MAX_VIDEOS_PER_ACCOUNT ?? 60),
    maxProductsPerShop: Number(env.TIKTOK_CHROME_MAX_PRODUCTS_PER_SHOP ?? 6),
    persistentBrowserRoot,
    playwrightProfileDir:
      env.TIKTOK_PLAYWRIGHT_RUN_PROFILE_DIR ??
      env.TIKTOK_PLAYWRIGHT_PROFILE_DIR ??
      path.join(
        persistentBrowserRoot,
        usingLocalRuntimeRoot ? "tiktok-monitor-run-profile-headless" : "tiktok-monitor-run-profile-headless"
      ),
    playwrightSourceProfileDir:
      env.TIKTOK_SHARED_SOURCE_PROFILE_DIR ??
      env.TIKTOK_PLAYWRIGHT_SOURCE_PROFILE_DIR ??
      path.join(
        persistentBrowserRoot,
        usingLocalRuntimeRoot ? "tiktok-monitor-profile-headed" : "shared-source-profile"
      ),
    playwrightSeedProfileDir: env.TIKTOK_PLAYWRIGHT_SEED_PROFILE_DIR,
    chatgptPlaywrightRunProfileDir:
      env.CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR ??
      path.join(
        persistentBrowserRoot,
        usingLocalRuntimeRoot ? "chatgpt-web-run-profile-headed" : "chatgpt-web-run-profile-headed"
      ),
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
    cobrowserFresh: parseBoolean(env.COBROWSER_FRESH, true)
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

function defaultPersistentBrowserRoot({ homeDir = os.homedir() } = {}) {
  const sharedRoot = path.join(homeDir, ".codex", "persistent-browser-profiles");
  if (fs.existsSync(sharedRoot)) {
    return sharedRoot;
  }
  return defaultLocalMonitorRuntimeRoot();
}

function defaultLocalMonitorRuntimeRoot() {
  return path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".runtime", "browser"));
}

function isLocalMonitorRuntimeRoot(rootDir) {
  return path.resolve(rootDir) === defaultLocalMonitorRuntimeRoot();
}
