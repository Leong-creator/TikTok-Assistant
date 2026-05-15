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

  assert.equal(config.source, "cobrowser");
  assert.equal(config.maxVideosPerAccount, 60);
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

test("resolveMonitorConfig falls back to the local monitor runtime profile when the shared root does not exist", () => {
  const originalExistsSync = fs.existsSync;
  fs.existsSync = (targetPath) => {
    if (targetPath === path.join(os.homedir(), ".codex", "persistent-browser-profiles")) {
      return false;
    }
    return originalExistsSync(targetPath);
  };

  try {
    const config = resolveMonitorConfig({});
    assert.match(config.persistentBrowserRoot, /TikTok Project Monitor[\\/]\.runtime[\\/]browser$/u);
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
