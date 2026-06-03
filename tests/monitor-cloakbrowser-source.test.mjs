import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { collectCloakBrowserSnapshots } from "../src/monitor/cloakbrowser-source.mjs";

test("collectCloakBrowserSnapshots launches a CloakBrowser context and annotates snapshot sources", async () => {
  const profileRoot = await mkdtemp(path.join(tmpdir(), "tk-cloak-source-"));
  const calls = [];
  const context = {
    async close() {
      calls.push("closed");
    }
  };

  try {
    const sourceProfileDir = path.join(profileRoot, "source");
    const runProfileDir = path.join(profileRoot, "run");
    await mkdir(sourceProfileDir, { recursive: true });

    const result = await collectCloakBrowserSnapshots({
      videos: [
        {
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/1"
        }
      ],
      config: {
        cloakbrowserProfileDir: runProfileDir,
        cloakbrowserSourceProfileDir: sourceProfileDir,
        cloakbrowserEphemeral: false,
        launchCloakBrowserPersistentContext: async (options) => {
          calls.push(options);
          return context;
        },
        createPlaywrightBrowserClient: ({ context: browserContext }) => ({ context: browserContext }),
        collectChromeSnapshots: async ({ videos }) => ({
          source: "ignored",
          collectedAt: "2026-05-16T10:00:00.000Z",
          videoSnapshots: videos.map((video) => ({
            collectedAt: "2026-05-16T10:00:00.000Z",
            accountHandle: video.accountHandle,
            videoUrl: video.videoUrl,
            views: 1,
            likes: 2,
            comments: 3,
            shares: 4,
            productRefs: []
          })),
          productSnapshots: [],
          failures: []
        })
      }
    });

    assert.equal(result.source, "cloakbrowser");
    assert.equal(result.videoSnapshots[0].source, "cloakbrowser");
    assert.equal(calls[0].userDataDir, runProfileDir);
    assert.equal(calls[0].headless, true);
    assert.equal(calls[0].humanize, true);
    assert.deepEqual(calls.at(-1), "closed");
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
});

test("collectCloakBrowserSnapshots keeps the context open until async collection finishes", async () => {
  const profileRoot = await mkdtemp(path.join(tmpdir(), "tk-cloak-source-await-"));
  const calls = [];
  const context = {
    async close() {
      calls.push("closed");
    }
  };

  try {
    const sourceProfileDir = path.join(profileRoot, "source");
    const runProfileDir = path.join(profileRoot, "run");
    await mkdir(sourceProfileDir, { recursive: true });

    await collectCloakBrowserSnapshots({
      videos: [{ accountHandle: "book_alpha", videoUrl: "https://www.tiktok.com/@book_alpha/video/1" }],
      config: {
        cloakbrowserProfileDir: runProfileDir,
        cloakbrowserSourceProfileDir: sourceProfileDir,
        cloakbrowserEphemeral: false,
        launchCloakBrowserPersistentContext: async () => context,
        createPlaywrightBrowserClient: () => ({ fake: true }),
        collectChromeSnapshots: async () => {
          calls.push("collect-start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          calls.push("collect-end");
          assert.deepEqual(calls, ["collect-start", "collect-end"]);
          return {
            source: "ignored",
            collectedAt: "2026-05-16T10:00:00.000Z",
            videoSnapshots: [],
            productSnapshots: [],
            failures: []
          };
        }
      }
    });

    assert.deepEqual(calls, ["collect-start", "collect-end", "closed"]);
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
});

test("collectCloakBrowserSnapshots can attach Dokobot fallback hooks without changing the primary collector contract", async () => {
  const profileRoot = await mkdtemp(path.join(tmpdir(), "tk-cloak-source-dokobot-"));
  const context = {
    async close() {}
  };

  try {
    const sourceProfileDir = path.join(profileRoot, "source");
    const runProfileDir = path.join(profileRoot, "run");
    await mkdir(sourceProfileDir, { recursive: true });

    let receivedConfig = null;
    await collectCloakBrowserSnapshots({
      videos: [],
      config: {
        cloakbrowserProfileDir: runProfileDir,
        cloakbrowserSourceProfileDir: sourceProfileDir,
        cloakbrowserEphemeral: false,
        dokobotFallback: true,
        launchCloakBrowserPersistentContext: async () => context,
        createPlaywrightBrowserClient: () => ({ fake: true }),
        createDokobotFallbackHooks: async () => ({
          extractProfileVideosFallback: async () => ({ status: "missing_metrics", reason: "fallback" }),
          extractDirectVideoFallback: async () => ({ status: "missing_metrics", reason: "fallback" })
        }),
        collectChromeSnapshots: async ({ config }) => {
          receivedConfig = config;
          return {
            source: "ignored",
            collectedAt: "2026-05-16T10:00:00.000Z",
            videoSnapshots: [],
            productSnapshots: [],
            failures: []
          };
        }
      }
    });

    assert.equal(typeof receivedConfig.extractProfileVideosFallback, "function");
    assert.equal(typeof receivedConfig.extractDirectVideoFallback, "function");
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
});

test("collectCloakBrowserSnapshots composes Bright Data and Dokobot fallback hooks in order", async () => {
  const profileRoot = await mkdtemp(path.join(tmpdir(), "tk-cloak-source-fallback-chain-"));
  const context = {
    async close() {}
  };

  try {
    const sourceProfileDir = path.join(profileRoot, "source");
    const runProfileDir = path.join(profileRoot, "run");
    await mkdir(sourceProfileDir, { recursive: true });

    let profileFallback;
    let detailFallback;
    await collectCloakBrowserSnapshots({
      videos: [],
      config: {
        cloakbrowserProfileDir: runProfileDir,
        cloakbrowserSourceProfileDir: sourceProfileDir,
        cloakbrowserEphemeral: false,
        brightDataFallback: true,
        dokobotFallback: true,
        launchCloakBrowserPersistentContext: async () => context,
        createPlaywrightBrowserClient: () => ({ fake: true }),
        createBrightDataFallbackHooks: async () => ({
          extractProfileVideosFallback: async () => ({ status: "missing_metrics", reason: "brightdata-miss" }),
          extractDirectVideoFallback: async () => ({ status: "missing_metrics", reason: "brightdata-miss" })
        }),
        createDokobotFallbackHooks: async () => ({
          extractProfileVideosFallback: async ({ primaryResult }) => {
            assert.equal(primaryResult.reason, "brightdata-miss");
            return { status: "ok", videoLinks: [] };
          },
          extractDirectVideoFallback: async ({ primaryResult }) => {
            assert.equal(primaryResult.reason, "brightdata-miss");
            return {
              status: "ok",
              video: {
                accountHandle: "alpha",
                videoUrl: "https://www.tiktok.com/@alpha/video/1",
                views: 1,
                likes: 2,
                comments: 3,
                shares: 4,
                productRefs: []
              }
            };
          }
        }),
        collectChromeSnapshots: async ({ config }) => {
          profileFallback = config.extractProfileVideosFallback;
          detailFallback = config.extractDirectVideoFallback;
          return {
            source: "ignored",
            collectedAt: "2026-05-16T10:00:00.000Z",
            videoSnapshots: [],
            productSnapshots: [],
            failures: []
          };
        }
      }
    });

    const profileResult = await profileFallback({
      account: { handle: "alpha", profileUrl: "https://www.tiktok.com/@alpha" },
      primaryResult: { status: "missing_metrics", reason: "cloak-miss" }
    });
    const detailResult = await detailFallback({
      video: { accountHandle: "alpha", videoUrl: "https://www.tiktok.com/@alpha/video/1" },
      primaryResult: { status: "login_required", reason: "cloak-wall" }
    });

    assert.equal(profileResult.status, "ok");
    assert.equal(detailResult.status, "ok");
    assert.equal(detailResult.video.views, 1);
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
});
