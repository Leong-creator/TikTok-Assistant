import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runMonitorCycle } from "../src/monitor/monitor-cycle.mjs";

test("runMonitorCycle batches collection and completes analysis/report chain when new snapshots are produced", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cycle-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "");

    const batches = [
      {
        source: "cobrowser",
        batch: { videos: 3, accounts: 0, done: false },
        snapshots: { video: 2, product: 0 },
        cursor: { completed: false }
      },
      {
        source: "cobrowser",
        batch: { videos: 0, accounts: 1, done: false },
        snapshots: { video: 1, product: 0 },
        cursor: { completed: true }
      }
    ];

    const result = await runMonitorCycle({
      dataDir,
      source: "cobrowser",
      alertMode: "dm",
      alertRecipient: "ou_test_user",
      config: {
        runCoBrowserMonitorBatch: async () => {
          const next = batches.shift();
          await writeFile(
            path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
            JSON.stringify({ tick: Date.now() }) + "\n",
            { flag: "a" }
          );
          return next;
        },
        analyzeMonitorData: async () => ({ signals: 2 }),
        syncFeishuBaseDashboard: async () => ({ mappedRecordCount: 5 }),
        sendMonitorReport: async () => ({ sent: 1, messageId: "msg-1" })
      }
    });

    assert.equal(result.newSnapshots, 2);
    assert.equal(result.batches.length, 2);
    assert.equal(result.analysis.signals, 2);
    assert.equal(result.baseSync.mappedRecordCount, 5);
    assert.equal(result.report.sent, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runMonitorCycle skips analysis and reporting when no new snapshots are written", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cycle-empty-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "");

    const result = await runMonitorCycle({
      dataDir,
      source: "cobrowser",
      config: {
        runCoBrowserMonitorBatch: async () => ({
          source: "cobrowser",
          batch: { videos: 0, accounts: 0, done: true },
          snapshots: { video: 0, product: 0 },
          cursor: { completed: true }
        })
      }
    });

    assert.equal(result.newSnapshots, 0);
    assert.equal(result.analysis.signals, 0);
    assert.equal(result.baseSync, null);
    assert.equal(result.report, null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
