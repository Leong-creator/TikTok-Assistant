import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCloakBrowserMonitorBatch } from "../src/monitor/cloakbrowser-runner.mjs";

test("runCloakBrowserMonitorBatch advances collection cursor", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-batch-"));
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

    const result = await runCloakBrowserMonitorBatch({
      dataDir,
      now: new Date("2026-05-16T00:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1,
        collectCloakBrowserSnapshots: async ({ videos, now }) => ({
          source: "cloakbrowser",
          collectedAt: new Date(now).toISOString(),
          videoSnapshots: videos.map((video) => ({
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
          productSnapshots: [],
          failures: []
        })
      }
    });

    assert.equal(result.source, "cloakbrowser");
    assert.equal(result.batch.videos, 1);
    assert.equal(result.cursor.videoIndex, 1);

    const snapshotLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.match(snapshotLog, /Cloak batch/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
