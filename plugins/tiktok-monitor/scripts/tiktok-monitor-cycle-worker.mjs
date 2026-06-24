#!/usr/bin/env node
import {
  resolveRuntime,
  runSafeCycle,
  getManagedCycleArtifacts,
  writeManagedCycleState
} from "./tiktok-monitor.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    repoRoot: process.env.TIKTOK_MONITOR_REPO,
    dataDir: process.env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data",
    forceRefreshPlan: false,
    batchArgs: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--repo-root") {
      args.repoRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--data-dir") {
      args.dataDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--force-refresh-plan") {
      args.forceRefreshPlan = true;
      continue;
    }
    args.batchArgs.push(value);
  }
  return args;
}

function main() {
  const options = parseArgs();
  const runtime = resolveRuntime(options.repoRoot);
  const artifacts = getManagedCycleArtifacts(runtime.cwd, options.dataDir);
  const startedAt = new Date().toISOString();
  const writeRunningState = (progress = {}) => writeManagedCycleState(runtime.cwd, options.dataDir, {
    mode: "managed-background-cycle",
    status: "running",
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    repoRoot: runtime.cwd,
    dataDir: options.dataDir,
    forceRefreshPlan: options.forceRefreshPlan,
    batchArgs: options.batchArgs,
    logPath: artifacts.logPath,
    progress
  });
  writeRunningState({
    phase: "started",
    batchCount: 0
  });

  try {
    const result = runSafeCycle(runtime, options.dataDir, options.batchArgs, 1000, {
      forceRefreshPlan: options.forceRefreshPlan,
      onProgress(progress) {
        writeRunningState(progress);
      }
    });
    const finishedAt = new Date().toISOString();
    const failed = Boolean(result.rolloverDetected || result.iterationLimitReached);
    writeManagedCycleState(runtime.cwd, options.dataDir, {
      mode: "managed-background-cycle",
      status: failed ? "failed" : "completed",
      pid: process.pid,
      startedAt,
      updatedAt: finishedAt,
      finishedAt,
      repoRoot: runtime.cwd,
      dataDir: options.dataDir,
      forceRefreshPlan: options.forceRefreshPlan,
      batchArgs: options.batchArgs,
      logPath: artifacts.logPath,
      result
    });
    console.log(JSON.stringify(result, null, 2));
    if (failed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const failedAt = new Date().toISOString();
    writeManagedCycleState(runtime.cwd, options.dataDir, {
      mode: "managed-background-cycle",
      status: "failed",
      pid: process.pid,
      startedAt,
      updatedAt: failedAt,
      finishedAt: failedAt,
      repoRoot: runtime.cwd,
      dataDir: options.dataDir,
      forceRefreshPlan: options.forceRefreshPlan,
      batchArgs: options.batchArgs,
      logPath: artifacts.logPath,
      error: {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      }
    });
    throw error;
  }
}

main();
