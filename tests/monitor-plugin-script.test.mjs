import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  mapCommand,
  resolveMonitorRepoRoot,
  resolveRuntime,
  runSafeCycle
} from "../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs";

test("plugin command mapping keeps formal cloakbrowser batch and manual sync entrypoints", () => {
  assert.deepEqual(mapCommand("collect-batch", "monitoring_data"), [
    "collect-cloakbrowser-batch",
    "--data-dir",
    "monitoring_data",
    "--max-tabs",
    "1",
    "--max-seed-videos",
    "20",
    "--max-accounts",
    "1",
    "--cloakbrowser-humanize",
    "true",
    "--cloakbrowser-human-preset",
    "careful",
    "--disable-plan-rollover",
    "true"
  ]);
  assert.deepEqual(mapCommand("sync", "monitoring_data"), [
    "base-sync-manual",
    "--data-dir",
    "monitoring_data"
  ]);
  assert.deepEqual(mapCommand("status", "monitoring_data"), [
    "collect-status",
    "--data-dir",
    "monitoring_data"
  ]);
});

test("plugin runtime prefers explicit monitor repo over bundled runtime during development", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-repo-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");

    const runtime = resolveRuntime(repoRoot, repoRoot);
    assert.equal(runtime.cwd, repoRoot);
    assert.equal(runtime.cliPath, path.join(repoRoot, "src", "monitor-cli.mjs"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("plugin runtime can discover the monitor repo from a nearby cwd when no explicit root is provided", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-workspace-"));
  try {
    const repoRoot = path.join(workspaceRoot, "TikTok Project Monitor");
    const nestedCwd = path.join(workspaceRoot, "TikTok Project");
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");

    assert.equal(resolveMonitorRepoRoot(undefined, nestedCwd), repoRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("plugin CLI rejects direct bottom-layer commands", () => {
  const scriptPath = path.resolve("plugins/tiktok-monitor/scripts/tiktok-monitor.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "collect-batch"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported TikTok monitor plugin command: collect-batch/);
});

test("runSafeCycle loops collect-batch to completion and finishes with manual base sync", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-cycle-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "snapshots"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");

    const outputs = [
      {
        batch: { accounts: 1, videos: 20, done: false },
        snapshots: { video: 4, product: 0 },
        cursor: { accountIndex: 1, videoIndex: 20, completed: false }
      },
      {
        batch: { accounts: 0, videos: 10, done: true },
        snapshots: { video: 2, product: 0 },
        cursor: { accountIndex: 1, videoIndex: 30, completed: true }
      },
      {
        plan: { counts: { accounts: 1, accountTargets: 1, videoTargets: 30 } },
        cursor: { accountIndex: 1, videoIndex: 30, completed: true }
      },
      {
        inserted: { archive: 3, likes: 1, increments: 0 }
      }
    ];
    const calls = [];
    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const fakeExecFileSync = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const next = outputs.shift();
      if (!next) {
        throw new Error("unexpected extra exec");
      }
      return JSON.stringify(next);
    };

    const module = await import("../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs");
    module.__setExecFileSyncForTests?.(fakeExecFileSync);
    try {
      const result = runSafeCycle(runtime, "monitoring_data", ["--dry-run"], 5);
      assert.equal(result.mode, "manual-base-safe-cycle");
      assert.equal(result.batchCount, 2);
      assert.equal(result.status.cursor.completed, true);
      assert.equal(result.baseSync.inserted.likes, 1);
      assert.equal(result.rolloverDetected, false);
      assert.deepEqual(
        calls.map((call) => call.args[1]),
        [
          "collect-cloakbrowser-batch",
          "collect-cloakbrowser-batch",
          "collect-status",
          "base-sync-manual"
        ]
      );
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("runSafeCycle stops before sync when a batch rolls into a different plan", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-rollover-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "snapshots"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");

    const outputs = [
      {
        batch: { accounts: 1, videos: 20, done: false },
        snapshots: { video: 4, product: 0 },
        cursor: { planCreatedAt: "plan-a", accountIndex: 1, videoIndex: 20, completed: false }
      },
      {
        batch: { accounts: 0, videos: 20, done: false },
        snapshots: { video: 4, product: 0 },
        cursor: { planCreatedAt: "plan-b", accountIndex: 1, videoIndex: 40, completed: false }
      },
      {
        plan: { counts: { accounts: 1, accountTargets: 1, videoTargets: 40 } },
        cursor: { planCreatedAt: "plan-b", accountIndex: 1, videoIndex: 40, completed: false }
      }
    ];
    const calls = [];
    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const fakeExecFileSync = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const next = outputs.shift();
      if (!next) {
        throw new Error("unexpected extra exec");
      }
      return JSON.stringify(next);
    };

    const module = await import("../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs");
    module.__setExecFileSyncForTests?.(fakeExecFileSync);
    try {
      const result = runSafeCycle(runtime, "monitoring_data", ["--dry-run"], 5);
      assert.equal(result.rolloverDetected, true);
      assert.equal(result.trackedPlanCreatedAt, "plan-a");
      assert.equal(result.rolloverCursor.planCreatedAt, "plan-b");
      assert.equal(result.baseSync, undefined);
      assert.deepEqual(
        calls.map((call) => call.args[1]),
        ["collect-cloakbrowser-batch", "collect-cloakbrowser-batch", "collect-status"]
      );
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
