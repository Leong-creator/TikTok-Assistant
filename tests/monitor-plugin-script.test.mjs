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
  runSafeCycle,
  startManagedBackgroundCycle,
  __setSpawnForTests,
  __setPidCheckForTests,
  __setExecFileSyncForTests,
  readManagedCycleState
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

test("plugin child node invocations always request hidden windows on Windows", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-hide-window-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "snapshots"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 1, likes: 1, increments: 1 } })}\n`
    );

    const outputs = [
      {
        plan: { createdAt: null, counts: { accounts: 1, accountTargets: 1, videoTargets: 1 } },
        cursor: { accountIndex: 0, videoIndex: 0, completed: false }
      },
      {
        batch: { accounts: 1, videos: 1, done: true },
        snapshots: { video: 1, product: 0 },
        cursor: { accountIndex: 1, videoIndex: 1, completed: true }
      },
      {
        plan: { counts: { accounts: 1, accountTargets: 1, videoTargets: 1 } },
        cursor: { accountIndex: 1, videoIndex: 1, completed: true }
      },
      {
        inserted: { archive: 1, likes: 0, increments: 0 }
      }
    ];
    const calls = [];
    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const fakeExecFileSync = (command, args, options) => {
      calls.push({ command, args, options });
      const next = outputs.shift();
      if (!next) {
        throw new Error("unexpected extra exec");
      }
      return JSON.stringify(next);
    };

    const module = await import("../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs");
    module.__setExecFileSyncForTests?.(fakeExecFileSync);
    try {
      runSafeCycle(runtime, "monitoring_data", [], 5);
      assert.ok(calls.length >= 4);
      assert.ok(calls.every((call) => call.options.windowsHide === true));
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
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
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 3210, likes: 77, increments: 8 } })}\n`
    );

    const outputs = [
      {
        plan: { createdAt: null, counts: { accounts: 1, accountTargets: 1, videoTargets: 30 } },
        cursor: { accountIndex: 0, videoIndex: 0, completed: false }
      },
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
      assert.equal(result.scope.currentPlanVideoTargets, 30);
      assert.equal(result.scope.archiveVideoCount, 3210);
      assert.equal(result.scope.collectorPlannedVideoTargets, 30);
      assert.deepEqual(
        calls.map((call) => call.args[1]),
        [
          "collect-status",
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
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 4444, likes: 12, increments: 3 } })}\n`
    );

    const outputs = [
      {
        plan: { createdAt: null, counts: { accounts: 1, accountTargets: 1, videoTargets: 40 } },
        cursor: { accountIndex: 0, videoIndex: 0, completed: false }
      },
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
      assert.equal(result.scope.currentPlanVideoTargets, 40);
      assert.equal(result.scope.archiveVideoCount, 4444);
      assert.equal(result.scope.collectorPlannedVideoTargets, 40);
      assert.deepEqual(
        calls.map((call) => call.args[1]),
        ["collect-status", "collect-cloakbrowser-batch", "collect-cloakbrowser-batch", "collect-status"]
      );
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("runSafeCycle resumes an incomplete current plan without refreshing a new one", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-resume-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "snapshots"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 5555, likes: 99, increments: 7 } })}\n`
    );

    const outputs = [
      {
        plan: { createdAt: "plan-a", counts: { accounts: 63, accountTargets: 63, videoTargets: 2341 } },
        cursor: { planCreatedAt: "plan-a", accountIndex: 63, videoIndex: 360, completed: false }
      },
      {
        batch: { accounts: 0, videos: 20, done: false },
        snapshots: { video: 4, product: 0 },
        cursor: { planCreatedAt: "plan-a", accountIndex: 63, videoIndex: 380, completed: false }
      },
      {
        batch: { accounts: 0, videos: 20, done: true },
        snapshots: { video: 3, product: 0 },
        cursor: { planCreatedAt: "plan-a", accountIndex: 63, videoIndex: 400, completed: true }
      },
      {
        plan: { counts: { accounts: 63, accountTargets: 63, videoTargets: 2341 } },
        cursor: { planCreatedAt: "plan-a", accountIndex: 63, videoIndex: 400, completed: true }
      },
      {
        inserted: { archive: 1, likes: 1, increments: 0 }
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
      assert.equal(result.trackedPlanCreatedAt, "plan-a");
      assert.equal(result.rolloverDetected, false);
      assert.equal(result.scope.currentPlanVideoTargets, 2341);
      assert.equal(result.scope.archiveVideoCount, 5555);
      assert.equal(result.scope.collectorPlannedVideoTargets, 2341);
      assert.deepEqual(
        calls.map((call) => call.args.slice(1)),
        [
          ["collect-status", "--data-dir", "monitoring_data"],
          [
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
            "true",
            "--dry-run"
          ],
          [
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
            "true",
            "--dry-run"
          ],
          ["collect-status", "--data-dir", "monitoring_data"],
          ["base-sync-manual", "--data-dir", "monitoring_data"]
        ]
      );
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("runSafeCycle retries manual base sync when the child exits with a transient control event", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-sync-retry-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "snapshots"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(path.join(repoRoot, "monitoring_data", "snapshots", "video_snapshots.jsonl"), "");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 6000, likes: 80, increments: 20 } })}\n`
    );

    const outputs = [
      {
        plan: { createdAt: null, counts: { accounts: 1, accountTargets: 1, videoTargets: 10 } },
        cursor: { accountIndex: 0, videoIndex: 0, completed: false }
      },
      {
        batch: { accounts: 1, videos: 10, done: true },
        snapshots: { video: 2, product: 0 },
        cursor: { accountIndex: 1, videoIndex: 10, completed: true }
      },
      {
        plan: { counts: { accounts: 1, accountTargets: 1, videoTargets: 10 } },
        cursor: { accountIndex: 1, videoIndex: 10, completed: true }
      },
      {
        inserted: { archive: 2, likes: 1, increments: 1 }
      }
    ];
    let syncAttempts = 0;
    const calls = [];
    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const fakeExecFileSync = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (args[1] === "base-sync-manual" && syncAttempts++ === 0) {
        const error = new Error("transient control event");
        error.status = 3221225786;
        throw error;
      }
      const next = outputs.shift();
      if (!next) {
        throw new Error("unexpected extra exec");
      }
      return JSON.stringify(next);
    };

    const module = await import("../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs");
    module.__setExecFileSyncForTests?.(fakeExecFileSync);
    try {
      const result = runSafeCycle(runtime, "monitoring_data", ["--dry-run"], 5, {
        baseSyncRetries: 1,
        baseSyncRetryDelayMs: 0
      });
      assert.equal(result.baseSync.inserted.archive, 2);
      assert.equal(syncAttempts, 2);
      assert.deepEqual(
        calls.map((call) => call.args[1]),
        ["collect-status", "collect-cloakbrowser-batch", "collect-status", "base-sync-manual", "base-sync-manual"]
      );
    } finally {
      module.__setExecFileSyncForTests?.(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("background cycle starts one managed worker and records runner state", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-background-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 3331, likes: 76, increments: 43 } })}\n`
    );

    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const spawnCalls = [];
    const fakeSpawn = (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return {
        pid: 4242,
        unref() {}
      };
    };
    const fakeExec = () =>
      JSON.stringify({
        plan: { counts: { accounts: 63, accountTargets: 63, videoTargets: 2341 } },
        cursor: { accountIndex: 63, videoIndex: 360, completed: false }
      });

    __setSpawnForTests(fakeSpawn);
    __setExecFileSyncForTests(fakeExec);
    __setPidCheckForTests((pid) => pid === 4242);
    try {
      const result = startManagedBackgroundCycle(runtime, "monitoring_data", ["--dry-run"]);
      assert.equal(result.started, true);
      assert.equal(result.alreadyRunning, false);
      assert.equal(result.managedCycle.pid, 4242);
      assert.equal(result.scope.currentPlanVideoTargets, 2341);
      assert.equal(result.scope.archiveVideoCount, 3331);
      assert.equal(spawnCalls.length, 1);
      assert.match(spawnCalls[0].args[0], /tiktok-monitor-cycle-worker\.mjs$/);
      assert.deepEqual(readManagedCycleState(repoRoot, "monitoring_data").batchArgs, ["--dry-run"]);
    } finally {
      __setSpawnForTests(null);
      __setExecFileSyncForTests(null);
      __setPidCheckForTests(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("background cycle does not start a second worker when one is already active", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-plugin-background-running-"));
  try {
    await mkdir(path.join(repoRoot, ".runtime"), { recursive: true });
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data", "state"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "state", "manual_base_sync_state.json"),
      `${JSON.stringify({ counts: { archive: 3331, likes: 76, increments: 43 } })}\n`
    );
    await writeFile(
      path.join(repoRoot, ".runtime", "tiktok-monitor-cycle-state.json"),
      `${JSON.stringify({ status: "running", pid: 5151, startedAt: "2026-06-06T00:00:00.000Z" })}\n`
    );

    const runtime = {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
    const spawnCalls = [];
    const fakeSpawn = () => {
      spawnCalls.push(true);
      return {
        pid: 9999,
        unref() {}
      };
    };
    const fakeExec = () =>
      JSON.stringify({
        plan: { counts: { accounts: 63, accountTargets: 63, videoTargets: 2341 } },
        cursor: { accountIndex: 63, videoIndex: 360, completed: false }
      });

    __setSpawnForTests(fakeSpawn);
    __setExecFileSyncForTests(fakeExec);
    __setPidCheckForTests((pid) => pid === 5151);
    try {
      const result = startManagedBackgroundCycle(runtime, "monitoring_data");
      assert.equal(result.started, false);
      assert.equal(result.alreadyRunning, true);
      assert.equal(spawnCalls.length, 0);
      assert.equal(result.managedCycle.pid, 5151);
      assert.equal(result.scope.currentPlanVideoTargets, 2341);
      assert.equal(result.scope.archiveVideoCount, 3331);
    } finally {
      __setSpawnForTests(null);
      __setExecFileSyncForTests(null);
      __setPidCheckForTests(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
