import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveMonitorConfig } from "../src/monitor/config.mjs";

test("resolveMonitorConfig includes Chrome plugin batch limits", () => {
  const config = resolveMonitorConfig({
    TIKTOK_CHROME_MAX_VIDEOS_PER_ACCOUNT: "4",
    TIKTOK_CHROME_MAX_PRODUCTS_PER_SHOP: "3"
  });

  assert.equal(config.maxVideosPerAccount, 4);
  assert.equal(config.maxProductsPerShop, 3);
});

test("resolveMonitorConfig defaults account monitoring to high coverage and three-hour thresholds", () => {
  const config = resolveMonitorConfig({});

  assert.equal(config.source, "cloakbrowser");
  assert.equal(config.maxVideosPerAccount, 60);
  assert.equal(config.maxTabs, 1);
  assert.equal(config.collectionIntervalHours, 3);
  assert.equal(config.min3hViews, 3000);
  assert.equal(config.min3hLikes, 3000);
  assert.equal(config.min3hShares, 500);
  assert.equal(config.min3hComments, 100);
});

test("resolveMonitorConfig supports playwright-persistent source defaults", () => {
  const config = resolveMonitorConfig({
    TIKTOK_MONITOR_SOURCE: "playwright-persistent",
    TIKTOK_PLAYWRIGHT_RUN_PROFILE_DIR: "profiles/tiktok-monitor-headless",
    TIKTOK_SHARED_SOURCE_PROFILE_DIR: "profiles/shared-source",
    CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR: "profiles/chatgpt-headed",
    TIKTOK_PLAYWRIGHT_SEED_PROFILE_DIR: "profiles/tiktok-seed",
    TIKTOK_PLAYWRIGHT_HEADLESS: "true",
    TIKTOK_PLAYWRIGHT_CHANNEL: "chrome-beta"
  });

  assert.equal(config.source, "playwright-persistent");
  assert.equal(config.playwrightProfileDir, "profiles/tiktok-monitor-headless");
  assert.equal(config.playwrightSourceProfileDir, "profiles/shared-source");
  assert.equal(config.chatgptPlaywrightRunProfileDir, "profiles/chatgpt-headed");
  assert.equal(config.playwrightSeedProfileDir, "profiles/tiktok-seed");
  assert.equal(config.playwrightHeadless, true);
  assert.equal(config.playwrightChannel, "chrome-beta");
});

test("resolveMonitorConfig prefers CoBrowser as the machine-wide persistent browser root", () => {
  const config = resolveMonitorConfig({
    COBROWSER_HOME: "profiles/cobrowser"
  });

  assert.equal(config.persistentBrowserRoot, "profiles/cobrowser");
  assert.equal(config.playwrightSourceProfileDir, path.join("profiles/cobrowser", "source-profile"));
  assert.equal(
    config.playwrightProfileDir,
    path.join("profiles/cobrowser", "run-profiles", "tiktok-monitor-run-profile-headless")
  );
  assert.equal(
    config.chatgptPlaywrightRunProfileDir,
    path.join("profiles/cobrowser", "run-profiles", "chatgpt-web-run-profile-headed")
  );
});

test("resolveMonitorConfig falls back to the local monitor runtime profile when shared roots do not exist", () => {
  const originalExistsSync = fs.existsSync;
  fs.existsSync = (targetPath) => {
    if (targetPath === path.join(os.homedir(), ".codex-cobrowser")) {
      return false;
    }
    if (targetPath === path.join(os.homedir(), ".codex", "persistent-browser-profiles")) {
      return false;
    }
    return originalExistsSync(targetPath);
  };

  try {
    const config = resolveMonitorConfig({});
    assert.match(config.persistentBrowserRoot, /TikTok Project(?:[\\/]\.worktrees[\\/][^\\/]+)?[\\/]\.runtime[\\/]browser$/u);
    assert.match(config.playwrightSourceProfileDir, /tiktok-monitor-profile-headed$/u);
    assert.match(config.playwrightProfileDir, /tiktok-monitor-run-profile-headless$/u);
  } finally {
    fs.existsSync = originalExistsSync;
  }
});

test("resolveMonitorConfig exposes CoBrowser defaults", () => {
  const config = resolveMonitorConfig({
    COBROWSER_ROOT_DIR: "profiles/cobrowser",
    COBROWSER_RUNTIME_MODULE: "C:/plugins/cobrowser/lib/runtime.mjs",
    COBROWSER_HEADLESS: "false",
    COBROWSER_PROFILE: "named-headless",
    COBROWSER_FRESH: "false"
  });

  assert.equal(config.cobrowserRoot, "profiles/cobrowser");
  assert.equal(config.cobrowserRuntimeModule, "C:/plugins/cobrowser/lib/runtime.mjs");
  assert.equal(config.cobrowserHeadless, false);
  assert.equal(config.cobrowserProfile, "named-headless");
  assert.equal(config.cobrowserFresh, false);
});

test("resolveMonitorConfig exposes CloakBrowser defaults", () => {
  const config = resolveMonitorConfig({
    TIKTOK_CLOAKBROWSER_RUN_PROFILE_DIR: "profiles/cloak/run",
    TIKTOK_CLOAKBROWSER_SOURCE_PROFILE_DIR: "profiles/cloak/source",
    TIKTOK_CLOAKBROWSER_SEED_PROFILE_DIR: "profiles/cloak/seed",
    TIKTOK_CLOAKBROWSER_HEADLESS: "false",
    TIKTOK_CLOAKBROWSER_FRESH: "false",
    TIKTOK_CLOAKBROWSER_HUMANIZE: "true",
    TIKTOK_CLOAKBROWSER_HUMAN_PRESET: "slow",
    TIKTOK_CLOAKBROWSER_LOCALE: "en-US",
    TIKTOK_CLOAKBROWSER_TIMEZONE: "America/New_York",
    TIKTOK_CLOAKBROWSER_PROXY: "http://127.0.0.1:8000"
  });

  assert.equal(config.cloakbrowserProfileDir, "profiles/cloak/run");
  assert.equal(config.cloakbrowserSourceProfileDir, "profiles/cloak/source");
  assert.equal(config.cloakbrowserSeedProfileDir, "profiles/cloak/seed");
  assert.equal(config.cloakbrowserHeadless, false);
  assert.equal(config.cloakbrowserFresh, false);
  assert.equal(config.cloakbrowserHumanize, true);
  assert.equal(config.cloakbrowserHumanPreset, "slow");
  assert.equal(config.cloakbrowserLocale, "en-US");
  assert.equal(config.cloakbrowserTimezone, "America/New_York");
  assert.equal(config.cloakbrowserProxy, "http://127.0.0.1:8000");
});
