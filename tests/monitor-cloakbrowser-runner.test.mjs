import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCloakBrowserMonitorBatch } from "../src/monitor/cloakbrowser-runner.mjs";
import { createCollectionPlan, readCollectionCursor, readCollectionPlan } from "../src/monitor/collection-plan.mjs";

test("runCloakBrowserMonitorBatch advances collection cursor", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-batch-"));
  try {
    const seedVideoUrl = "https://www.tiktok.com/@book_alpha/video/7623225588626590990";
    const generatedAccountVideoUrl = "https://www.tiktok.com/@book_alpha/video/7629734921489206542";
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true,
          evidenceUrls: [seedVideoUrl]
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const result = await runCloakBrowserMonitorBatch({
      dataDir,
      now: new Date("2026-05-16T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectCloakBrowserSnapshots: async ({ videos, accounts, now }) => ({
          source: "cloakbrowser",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: [
            ...videos.map((video) => ({
              collectedAt: new Date(now).toISOString(),
              source: "cloakbrowser",
              accountHandle: video.accountHandle,
              videoUrl: video.videoUrl,
              caption: "Cloak batch",
              views: 7,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            })),
            ...accounts.map((account) => ({
              collectedAt: new Date(now).toISOString(),
              source: "cloakbrowser",
              accountHandle: account.handle,
              videoUrl: generatedAccountVideoUrl,
              caption: "Cloak account batch",
              views: 7,
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

    assert.equal(result.source, "cloakbrowser");
    assert.equal(result.batch.videos, 0);
    assert.equal(result.batch.accounts, 1);
    assert.equal(result.cursor.videoIndex, 0);
    assert.equal(result.cursor.accountIndex, 1);

    const snapshotLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.match(snapshotLog, /Cloak account batch/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runCloakBrowserMonitorBatch refreshes discovery before rebuilding the plan", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-discovery-"));
  try {
    const discoveredVideoUrl = "https://www.tiktok.com/@book_alpha/video/7615603816745979166";
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(path.join(dataDir, "seeds", "accounts.json"), JSON.stringify([]));
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const calls = [];
    const result = await runCloakBrowserMonitorBatch({
      dataDir,
      refreshPlan: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        discoverCloakBrowserAccountCandidates: async ({ queries }) => {
          calls.push({ kind: "discover", queries });
          await writeFile(
            path.join(dataDir, "seeds", "accounts.json"),
            JSON.stringify([
              {
                id: "account-alpha",
                handle: "book_alpha",
                profileUrl: "https://www.tiktok.com/@book_alpha",
                enabled: true,
                evidenceUrls: [discoveredVideoUrl]
              }
            ])
          );
        },
        collectCloakBrowserSnapshots: async ({ videos, accounts, now }) => {
          calls.push({
            kind: "collect",
            videos: videos.map((video) => video.videoUrl),
            accounts: accounts.map((account) => account.handle)
          });
          return {
            source: "cloakbrowser",
            collectedAt: new Date(now).toISOString(),
            videoSnapshots: videos.map((video) => ({
              collectedAt: new Date(now).toISOString(),
              source: "cloakbrowser",
              accountHandle: video.accountHandle,
              videoUrl: video.videoUrl,
              caption: "Discovered batch",
              views: 7,
              likes: 1,
              comments: 0,
              shares: 0,
              productRefs: []
            })),
            productSnapshots: [],
            failures: []
          };
        }
      }
    });

    assert.equal(calls[0].kind, "discover");
    assert.equal(calls[1].kind, "collect");
    assert.deepEqual(calls[1].accounts, ["book_alpha"]);
    assert.deepEqual(calls[1].videos, []);
    assert.equal(result.planned.videoTargets, 1);
    assert.equal(result.planned.accountTargets, 1);
    assert.equal(result.batch.videos, 0);
    assert.equal(result.batch.accounts, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runCloakBrowserMonitorBatch rebuilds whitelist video targets after the account pass", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-whitelist-rebuild-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "state"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        {
          collectedAt: "2026-05-20T13:00:00.000Z",
          postedAt: "2026-05-20T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: "https://www.tiktok.com/@alpha/video/7623225588626590990"
        },
        {
          collectedAt: "2026-05-20T14:00:00.000Z",
          postedAt: "2026-05-19T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: "https://www.tiktok.com/@alpha/video/7629734921489206542"
        }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );

    await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-21T00:00:00.000Z"),
      whitelistAccounts: [
        {
          id: "wl-alpha",
          handle: "alpha",
          profileUrl: "https://www.tiktok.com/@alpha",
          sourceTables: ["People Skills"],
          materialTypes: ["AI动画"],
          skipTracking: false
        }
      ]
    });

    const result = await runCloakBrowserMonitorBatch({
      dataDir,
      now: new Date("2026-05-21T00:05:00.000Z"),
      config: {
        maxSeedVideos: 5,
        maxAccounts: 1,
        enableDiscoveryRefresh: false,
        collectCloakBrowserSnapshots: async ({ accounts, now }) => ({
          source: "cloakbrowser",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: accounts.map((account) => ({
            collectedAt: new Date(now).toISOString(),
            source: "cloakbrowser",
            accountHandle: account.handle,
            videoUrl: "https://www.tiktok.com/@alpha/video/7623225588626590990",
            caption: "Homepage-covered video",
            views: 9500,
            likes: 10,
            comments: 1,
            shares: 1,
            postedAt: "2026-05-20T00:00:00.000Z",
            productRefs: []
          })),
          productSnapshots: [],
          failures: []
        })
      }
    });

    const cursor = await readCollectionCursor(dataDir);
    const plan = await readCollectionPlan(dataDir);

    assert.equal(result.batch.accounts, 1);
    assert.equal(cursor.accountIndex, 1);
    assert.equal(cursor.videoIndex, 0);
    assert.equal(plan.counts.videoTargets, 1);
    assert.deepEqual(plan.videoTargets.map((item) => item.videoUrl), [
      "https://www.tiktok.com/@alpha/video/7629734921489206542"
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runCloakBrowserMonitorBatch enriches queued retry videos with latest snapshot metrics before collection", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-video-enrich-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "state"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      `${JSON.stringify({
        collectedAt: "2026-05-20T14:00:00.000Z",
        postedAt: "2026-05-19T00:00:00.000Z",
        accountHandle: "alpha",
        videoUrl: "https://www.tiktok.com/@alpha/video/7629734921489206542",
        views: 4321,
        likes: 98,
        comments: 7,
        shares: 6,
        caption: "Known alpha video",
        productRefs: []
      })}\n`
    );
    await writeFile(
      path.join(dataDir, "state", "chrome_collect_plan.json"),
      JSON.stringify(
        {
          createdAt: "2026-05-21T00:00:00.000Z",
          counts: { accounts: 0, accountTargets: 0, videoTargets: 1 },
          accountTargets: [],
          videoTargets: [
            {
              id: "video-alpha-7629734921489206542",
              accountHandle: "alpha",
              videoUrl: "https://www.tiktok.com/@alpha/video/7629734921489206542",
              enabled: true,
              latestCollectedAt: "2026-05-20T14:00:00.000Z",
              latestPublishedAt: "2026-05-19T00:00:00.000Z"
            }
          ]
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "state", "chrome_collect_cursor.json"),
      JSON.stringify(
        {
          planCreatedAt: "2026-05-21T00:00:00.000Z",
          accountIndex: 0,
          videoIndex: 0,
          completed: false
        },
        null,
        2
      )
    );

    let receivedVideo = null;
    await runCloakBrowserMonitorBatch({
      dataDir,
      now: new Date("2026-05-21T00:05:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        enableDiscoveryRefresh: false,
        collectCloakBrowserSnapshots: async ({ videos, now }) => {
          receivedVideo = videos[0];
          return {
            source: "cloakbrowser",
            collectedAt: new Date(now).toISOString(),
            videoSnapshots: [],
            productSnapshots: [],
            failures: []
          };
        }
      }
    });

    assert.equal(receivedVideo.views, 4321);
    assert.equal(receivedVideo.likes, 98);
    assert.equal(receivedVideo.comments, 7);
    assert.equal(receivedVideo.shares, 6);
    assert.equal(receivedVideo.caption, "Known alpha video");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runCloakBrowserMonitorBatch advances only by the processed video count when a recycle is requested", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-partial-video-progress-"));
  try {
    await mkdir(path.join(dataDir, "state"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      ""
    );
    await writeFile(
      path.join(dataDir, "state", "chrome_collect_plan.json"),
      JSON.stringify(
        {
          createdAt: "2026-05-21T00:00:00.000Z",
          counts: { accounts: 0, accountTargets: 0, videoTargets: 3 },
          accountTargets: [],
          videoTargets: [
            {
              id: "video-alpha-1",
              accountHandle: "alpha",
              videoUrl: "https://www.tiktok.com/@alpha/video/1",
              enabled: true
            },
            {
              id: "video-alpha-2",
              accountHandle: "alpha",
              videoUrl: "https://www.tiktok.com/@alpha/video/2",
              enabled: true
            },
            {
              id: "video-alpha-3",
              accountHandle: "alpha",
              videoUrl: "https://www.tiktok.com/@alpha/video/3",
              enabled: true
            }
          ]
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "state", "chrome_collect_cursor.json"),
      JSON.stringify(
        {
          planCreatedAt: "2026-05-21T00:00:00.000Z",
          accountIndex: 0,
          videoIndex: 0,
          completed: false
        },
        null,
        2
      )
    );

    const result = await runCloakBrowserMonitorBatch({
      dataDir,
      now: new Date("2026-05-21T00:05:00.000Z"),
      config: {
        maxSeedVideos: 3,
        maxAccounts: 1,
        enableDiscoveryRefresh: false,
        collectCloakBrowserSnapshots: async ({ now }) => ({
          source: "cloakbrowser",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: [],
          productSnapshots: [],
          failures: [
            { status: "login_required", targetType: "video", targetUrl: "https://www.tiktok.com/@alpha/video/1" },
            { status: "login_required", targetType: "video", targetUrl: "https://www.tiktok.com/@alpha/video/2" }
          ],
          processed: {
            videoTargets: 2,
            accountTargets: 0
          },
          recycleRequested: true,
          stopReason: "login_required_threshold"
        })
      }
    });

    const cursor = await readCollectionCursor(dataDir);

    assert.equal(result.batch.videos, 2);
    assert.equal(result.batch.accounts, 0);
    assert.equal(result.cursor.videoIndex, 2);
    assert.equal(cursor.videoIndex, 2);
    assert.equal(result.cursor.completed, false);
    assert.equal(result.recycleRequested, true);
    assert.equal(result.stopReason, "login_required_threshold");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
