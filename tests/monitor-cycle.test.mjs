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
    assert.deepEqual(result.coverage, {
      plannedAccounts: 1,
      plannedVideos: 3,
      processedAccounts: 1,
      processedVideos: 3,
      accountBatchCompleted: true,
      videoBatchCompleted: true,
      targetProcessingCompleted: true,
      refreshedVideoSnapshots: 3,
      failedTargets: 0
    });
    assert.equal(result.analysis.signals, 2);
    assert.equal(result.baseSync.mappedRecordCount, 5);
    assert.equal(result.report.sent, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runMonitorCycle forwards whitelist base config paths to base sync", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cycle-basecfg-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "");

    let receivedBaseSyncArgs = null;
    const result = await runMonitorCycle({
      dataDir,
      source: "cobrowser",
      config: {
        baseDashboardConfigPath: path.join(dataDir, "base_dashboard_whitelist_config.json"),
        recordMapPath: path.join(dataDir, "base_record_map_whitelist.json"),
        runCoBrowserMonitorBatch: async () => {
          await writeFile(
            path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
            JSON.stringify({ tick: Date.now() }) + "\n",
            { flag: "a" }
          );
          return {
            source: "cobrowser",
            batch: { videos: 1, accounts: 0, done: false },
            snapshots: { video: 1, product: 0 },
            cursor: { completed: true }
          };
        },
        analyzeMonitorData: async () => ({ signals: 1 }),
        syncFeishuBaseDashboard: async (args) => {
          receivedBaseSyncArgs = args;
          return { mappedRecordCount: 1 };
        },
        sendMonitorReport: async () => ({ sent: 1, messageId: "msg-basecfg" })
      }
    });

    assert.equal(result.baseSync.mappedRecordCount, 1);
    assert.equal(
      receivedBaseSyncArgs.baseDashboardConfigPath,
      path.join(dataDir, "base_dashboard_whitelist_config.json")
    );
    assert.equal(
      receivedBaseSyncArgs.recordMapPath,
      path.join(dataDir, "base_record_map_whitelist.json")
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runMonitorCycle supports cloakbrowser batches", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cycle-cloak-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "");

    const result = await runMonitorCycle({
      dataDir,
      source: "cloakbrowser",
      config: {
        runCloakBrowserMonitorBatch: async () => ({
          source: "cloakbrowser",
          batch: { videos: 1, accounts: 0, done: false },
          snapshots: { video: 0, product: 0 },
          cursor: { completed: true }
        })
      }
    });

    assert.equal(result.batches.length, 1);
    assert.equal(result.batches[0].source, "cloakbrowser");
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
    assert.deepEqual(result.coverage, {
      plannedAccounts: 0,
      plannedVideos: 0,
      processedAccounts: 0,
      processedVideos: 0,
      accountBatchCompleted: true,
      videoBatchCompleted: true,
      targetProcessingCompleted: true,
      refreshedVideoSnapshots: 0,
      failedTargets: 0
    });
    assert.equal(result.analysis.signals, 0);
    assert.equal(result.baseSync, null);
    assert.equal(result.report, null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runMonitorCycle reports partial video coverage even when cursor marks the cycle completed", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cycle-coverage-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "");

    const result = await runMonitorCycle({
      dataDir,
      source: "cloakbrowser",
      config: {
        runCloakBrowserMonitorBatch: async () => ({
          source: "cloakbrowser",
          planned: { accounts: 59, accountTargets: 59, videoTargets: 1687 },
          batch: { videos: 0, accounts: 59, done: false },
          snapshots: { video: 7, product: 0 },
          failures: new Array(12).fill({ reason: "login_required" }),
          cursor: { completed: true, accountIndex: 59, videoIndex: 0 }
        })
      }
    });

    assert.deepEqual(result.coverage, {
      plannedAccounts: 59,
      plannedVideos: 1687,
      processedAccounts: 59,
      processedVideos: 0,
      accountBatchCompleted: true,
      videoBatchCompleted: false,
      targetProcessingCompleted: false,
      refreshedVideoSnapshots: 7,
      failedTargets: 12
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
