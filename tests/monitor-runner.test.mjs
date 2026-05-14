import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runMonitorOnce } from "../src/monitor/runner.mjs";
import { collectMonitorSnapshots } from "../src/monitor/runner.mjs";
import { runPlaywrightPersistentMonitorBatch } from "../src/monitor/playwright-persistent-runner.mjs";

test("runMonitorOnce with mock source writes snapshots, signals, leads, and Feishu DM payloads", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-"));
  const sentAlerts = [];
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          lastKnownPostAt: "2026-05-09T01:00:00.000Z",
          enabled: true
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "shops.json"),
      JSON.stringify([
        {
          id: "shop-alpha",
          name: "Alpha Books",
          shopUrl: "https://www.tiktok.com/shop/alpha",
          enabled: true
        }
      ])
    );

    const result = await runMonitorOnce({
      dataDir,
      source: "mock",
      targets: ["accounts", "shops"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      alertMode: "dm",
      alertRecipient: "ou_test_user",
      notifier: {
        async send(alert) {
          sentAlerts.push(alert);
          return { status: "sent", messageId: `msg-${sentAlerts.length}` };
        }
      },
      config: {
        min6hViews: 3000,
        min24hViews: 10000,
        staleAccountDays: 60
      }
    });

    assert.equal(result.source, "mock");
    assert.ok(result.snapshots.video > 0);
    assert.ok(result.snapshots.product > 0);
    assert.ok(result.signals >= 2);
    assert.equal(sentAlerts.length, result.alerts.sent);
    assert.ok(sentAlerts.every((alert) => alert.channel === "feishu-dm"));
    assert.ok(sentAlerts.every((alert) => alert.recipient === "ou_test_user"));
    assert.match(sentAlerts[0].text, /热视频|热商品/);

    const videoSnapshotLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.ok(videoSnapshotLog.trim().split("\n").length >= 2);

    const signalLog = await readFile(path.join(dataDir, "signals", "signals.jsonl"), "utf8");
    const signals = signalLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(signals.some((signal) => signal.entityType === "video"));
    assert.ok(signals.some((signal) => signal.entityType === "product"));

    const alertLog = await readFile(path.join(dataDir, "alerts", "alerts.jsonl"), "utf8");
    const alerts = alertLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(alerts.every((alert) => alert.status === "sent"));

    const leadDirs = await readdir(path.join(dataDir, "leads"));
    assert.ok(leadDirs.length >= 1);
    const leadSource = JSON.parse(await readFile(path.join(dataDir, "leads", leadDirs[0], "source.json"), "utf8"));
    assert.equal(leadSource.source, "tiktok-monitor");
    assert.ok(leadSource.signal.entityUrl);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collectMonitorSnapshots backfills account seeds from resolved direct video snapshots", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-video-account-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "videos.json"),
      JSON.stringify([
        {
          id: "video-short",
          videoUrl: "https://www.tiktok.com/t/ZTk792FfQ",
          enabled: true
        }
      ])
    );

    const result = await collectMonitorSnapshots({
      dataDir,
      source: "chrome",
      targets: ["videos"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      browserClient: {
        async createTab() {
          return { id: "tab-1" };
        },
        async closeTab() {},
        async navigate() {},
        async extractDirectVideo() {
          return {
            status: "ok",
            video: {
              accountHandle: "book_alpha",
              videoUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979166",
              caption: "Public book video",
              views: 0,
              likes: 28600,
              comments: 181,
              shares: 4800,
              productRefs: []
            }
          };
        }
      },
      config: { maxTabs: 2 }
    });

    assert.equal(result.snapshots.video, 1);
    const accounts = JSON.parse(await readFile(path.join(dataDir, "seeds", "accounts.json"), "utf8"));
    assert.deepEqual(accounts, [
      {
        id: "account-book-alpha",
        handle: "book_alpha",
        profileUrl: "https://www.tiktok.com/@book_alpha",
        enabled: true,
        discoveredFrom: "video",
        lastDiscoveredAt: "2026-05-09T12:00:00.000Z"
      }
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collectMonitorSnapshots backfills shop seeds from video product references", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-video-shop-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "videos.json"),
      JSON.stringify([
        {
          id: "video-short",
          videoUrl: "https://www.tiktok.com/t/ZTk792FfQ",
          enabled: true
        }
      ])
    );

    await collectMonitorSnapshots({
      dataDir,
      source: "chrome",
      targets: ["videos"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      browserClient: {
        async createTab() {
          return { id: "tab-1" };
        },
        async closeTab() {},
        async navigate() {},
        async extractDirectVideo() {
          return {
            status: "ok",
            video: {
              accountHandle: "book_alpha",
              videoUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979166",
              caption: "Public book video",
              views: 12000,
              likes: 28600,
              comments: 181,
              shares: 4800,
              productRefs: [
                {
                  shopName: "Book Seller",
                  shopUrl: "https://www.tiktok.com/shop/book-seller",
                  productUrl: "https://www.tiktok.com/shop/p/people-skills-book"
                }
              ]
            }
          };
        }
      },
      config: { maxTabs: 2 }
    });

    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops.length, 1);
    assert.equal(shops[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
    assert.equal(shops[0].discoveredFrom, "video_product_ref");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collectMonitorSnapshots can limit direct video seed batches", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-video-limit-"));
  const visited = [];
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "videos.json"),
      JSON.stringify([
        { id: "video-1", videoUrl: "https://www.tiktok.com/@book/video/1", enabled: true },
        { id: "video-2", videoUrl: "https://www.tiktok.com/@book/video/2", enabled: true },
        { id: "video-3", videoUrl: "https://www.tiktok.com/@book/video/3", enabled: true }
      ])
    );

    const result = await collectMonitorSnapshots({
      dataDir,
      source: "chrome",
      targets: ["videos"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      browserClient: {
        async createTab() {
          return { id: "tab-1" };
        },
        async closeTab() {},
        async navigate(_tab, url) {
          visited.push(url);
        },
        async extractDirectVideo({ video }) {
          return {
            status: "ok",
            video: {
              accountHandle: "book_alpha",
              videoUrl: video.videoUrl,
              views: 1,
              likes: 2,
              comments: 3,
              shares: 4,
              productRefs: []
            }
          };
        }
      },
      config: { maxTabs: 1, maxSeedVideos: 2 }
    });

    assert.equal(result.snapshots.video, 2);
    assert.equal(result.selected.videos, 2);
    assert.deepEqual(visited, [
      "https://www.tiktok.com/@book/video/1",
      "https://www.tiktok.com/@book/video/2"
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collectMonitorSnapshots dispatches to playwright-persistent source", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-playwright-source-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(path.join(dataDir, "seeds", "accounts.json"), JSON.stringify([]));
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));
    await writeFile(
      path.join(dataDir, "seeds", "videos.json"),
      JSON.stringify([
        {
          id: "video-short",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979166",
          enabled: true
        }
      ])
    );

    const result = await collectMonitorSnapshots({
      dataDir,
      source: "playwright-persistent",
      targets: ["videos"],
      now: new Date("2026-05-13T00:00:00.000Z"),
      config: {
        collectPlaywrightPersistentSnapshots: async ({ videos }) => ({
          source: "playwright-persistent",
          collectedAt: "2026-05-13T00:00:00.000Z",
          videoSnapshots: videos.map((video) => ({
            collectedAt: "2026-05-13T00:00:00.000Z",
            source: "playwright-persistent",
            accountHandle: video.accountHandle,
            videoUrl: video.videoUrl,
            caption: "Persistent snapshot",
            views: 10,
            likes: 2,
            comments: 1,
            shares: 0,
            productRefs: []
          })),
          productSnapshots: [],
          failures: []
        })
      }
    });

    assert.equal(result.source, "playwright-persistent");
    assert.equal(result.snapshots.video, 1);
    const snapshotLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.match(snapshotLog, /Persistent snapshot/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("persistent batch runner advances collection cursor", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-persistent-batch-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true,
          evidenceUrls: ["https://www.tiktok.com/@book_alpha/video/735111"]
        },
        {
          id: "account-beta",
          handle: "book_beta",
          profileUrl: "https://www.tiktok.com/@book_beta",
          enabled: true
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const first = await runPlaywrightPersistentMonitorBatch({
      dataDir,
      now: new Date("2026-05-13T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectPlaywrightPersistentSnapshots: async ({ videos, accounts, now }) => ({
          source: "playwright-persistent",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: [
            ...videos.map((video) => ({
              collectedAt: new Date(now).toISOString(),
              source: "playwright-persistent",
              accountHandle: video.accountHandle,
              videoUrl: video.videoUrl,
              caption: "Video batch",
              views: 5,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            })),
            ...accounts.map((account) => ({
              collectedAt: new Date(now).toISOString(),
              source: "playwright-persistent",
              accountHandle: account.handle,
              videoUrl: `${account.profileUrl}/video/generated`,
              caption: "Account batch",
              views: 6,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            }))
          ],
          productSnapshots: [],
          failures: []
        })
      }
    });

    assert.equal(first.batch.videos, 1);
    assert.equal(first.batch.accounts, 0);
    assert.equal(first.cursor.videoIndex, 1);
    assert.equal(first.cursor.accountIndex, 0);

    const second = await runPlaywrightPersistentMonitorBatch({
      dataDir,
      now: new Date("2026-05-13T00:10:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectPlaywrightPersistentSnapshots: async ({ videos, accounts, now }) => ({
          source: "playwright-persistent",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: [
            ...videos.map((video) => ({
              collectedAt: new Date(now).toISOString(),
              source: "playwright-persistent",
              accountHandle: video.accountHandle,
              videoUrl: video.videoUrl,
              caption: "Video batch",
              views: 5,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            })),
            ...accounts.map((account) => ({
              collectedAt: new Date(now).toISOString(),
              source: "playwright-persistent",
              accountHandle: account.handle,
              videoUrl: `${account.profileUrl}/video/generated`,
              caption: "Account batch",
              views: 6,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            }))
          ],
          productSnapshots: [],
          failures: []
        })
      }
    });

    assert.equal(second.batch.videos, 0);
    assert.equal(second.batch.accounts, 1);
    assert.equal(second.cursor.videoIndex, 1);
    assert.equal(second.cursor.accountIndex, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("persistent batch runner automatically refreshes a completed plan into a new collection cycle", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-persistent-refresh-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true,
          evidenceUrls: ["https://www.tiktok.com/@book_alpha/video/735111"]
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const collectPlaywrightPersistentSnapshots = async ({ videos, now }) => ({
      source: "playwright-persistent",
      collectedAt: new Date(now).toISOString(),
      videoSnapshots: videos.map((video) => ({
        collectedAt: new Date(now).toISOString(),
        source: "playwright-persistent",
        accountHandle: video.accountHandle,
        videoUrl: video.videoUrl,
        caption: "Video batch",
        views: 5,
        likes: 1,
        comments: 0,
        shares: 0,
        productRefs: []
      })),
      productSnapshots: [],
      failures: []
    });

    const first = await runPlaywrightPersistentMonitorBatch({
      dataDir,
      now: new Date("2026-05-13T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectPlaywrightPersistentSnapshots
      }
    });

    assert.equal(first.cursor.completed, true);
    assert.equal(first.batch.videos, 1);

    const second = await runPlaywrightPersistentMonitorBatch({
      dataDir,
      now: new Date("2026-05-14T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectPlaywrightPersistentSnapshots
      }
    });

    assert.equal(second.batch.done, false);
    assert.equal(second.batch.videos, 1);
    assert.equal(second.cursor.videoIndex, 1);
    assert.equal(second.cursor.accountIndex, 0);
    assert.equal(second.cursor.completed, true);
    assert.equal(second.planned.videoTargets, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
