#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");
let execFileSyncImpl = execFileSync;
const supportedUserCommands = new Set(["cycle", "status", "sync", "setup"]);

export function __setExecFileSyncForTests(fn) {
  execFileSyncImpl = fn ?? execFileSync;
}

export function mapCommand(name, monitorDataDir) {
  if (name === "collect-batch") {
    return [
      "collect-cloakbrowser-batch",
      "--data-dir",
      monitorDataDir,
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
    ];
  }
  if (name === "sync") {
    return ["base-sync-manual", "--data-dir", monitorDataDir];
  }
  if (name === "status") {
    return ["collect-status", "--data-dir", monitorDataDir];
  }
  throw new Error(`Unsupported TikTok monitor plugin command: ${name}`);
}

export function resolveRuntime(explicitRoot, cwd = process.cwd()) {
  try {
    const repoRoot = resolveMonitorRepoRoot(explicitRoot, cwd);
    return {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
  } catch (error) {
    if (!explicitRoot && fs.existsSync(bundledCliPath)) {
      return {
        cliPath: bundledCliPath,
        cwd
      };
    }
    throw error;
  }
}

export function resolveMonitorRepoRoot(explicitRoot, cwd = process.cwd()) {
  const candidates = [];
  if (explicitRoot) candidates.push(explicitRoot);
  candidates.push(cwd);

  let current = path.resolve(cwd);
  for (let index = 0; index < 6; index += 1) {
    candidates.push(current);
    candidates.push(path.join(current, "TikTok Project Monitor"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, "src", "monitor-cli.mjs"))) {
      return root;
    }
  }

  throw new Error(
    "Unable to locate the TikTok monitor repository. Set TIKTOK_MONITOR_REPO to the repo root that contains src/monitor-cli.mjs."
  );
}

function execNodeScript(scriptPath, scriptArgs = [], cwd = process.cwd()) {
  execFileSyncImpl("node", [path.resolve(scriptPath), ...scriptArgs], {
    cwd,
    stdio: "inherit"
  });
}

function execNodeScriptJson(scriptPath, scriptArgs = [], cwd = process.cwd()) {
  const stdout = execFileSyncImpl("node", [path.resolve(scriptPath), ...scriptArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  return JSON.parse(stdout);
}

function countSnapshotLines(dataDir, cwd = process.cwd()) {
  const snapshotPath = path.join(cwd, dataDir, "snapshots", "video_snapshots.jsonl");
  if (!fs.existsSync(snapshotPath)) {
    return 0;
  }
  const text = fs.readFileSync(snapshotPath, "utf8");
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/u).filter(Boolean).length;
}

export function runSafeCycle(runtime, monitorDataDir, extraArgs = [], maxIterations = 1000) {
  const beforeSnapshots = countSnapshotLines(monitorDataDir, runtime.cwd);
  const batches = [];
  let refreshPlan = true;
  let trackedPlanCreatedAt = null;
  let rolloverDetected = false;
  let rolloverCursor = null;
  let cycleCompleted = false;

  for (let index = 0; index < maxIterations; index += 1) {
    const commandArgs = mapCommand("collect-batch", monitorDataDir);
    if (refreshPlan) {
      commandArgs.push("--refresh-plan");
    }
    const batchResult = execNodeScriptJson(runtime.cliPath, [...commandArgs, ...extraArgs], runtime.cwd);
    if (!trackedPlanCreatedAt) {
      trackedPlanCreatedAt = batchResult.cursor?.planCreatedAt ?? null;
    } else if (
      trackedPlanCreatedAt &&
      batchResult.cursor?.planCreatedAt &&
      batchResult.cursor.planCreatedAt !== trackedPlanCreatedAt
    ) {
      rolloverDetected = true;
      rolloverCursor = batchResult.cursor;
      break;
    }
    batches.push(batchResult);
    refreshPlan = false;
    if (batchResult.cursor?.completed || batchResult.batch?.done) {
      cycleCompleted = true;
      break;
    }
  }

  const afterSnapshots = countSnapshotLines(monitorDataDir, runtime.cwd);
  const status = execNodeScriptJson(runtime.cliPath, mapCommand("status", monitorDataDir), runtime.cwd);
  if (rolloverDetected) {
    return {
      source: "cloakbrowser",
      mode: "manual-base-safe-cycle",
      newSnapshotLines: Math.max(0, afterSnapshots - beforeSnapshots),
      batches,
      batchCount: batches.length,
      trackedPlanCreatedAt,
      rolloverDetected,
      rolloverCursor,
      status
    };
  }
  if (!cycleCompleted) {
    return {
      source: "cloakbrowser",
      mode: "manual-base-safe-cycle",
      newSnapshotLines: Math.max(0, afterSnapshots - beforeSnapshots),
      batches,
      batchCount: batches.length,
      trackedPlanCreatedAt,
      rolloverDetected: false,
      iterationLimitReached: true,
      status
    };
  }
  const baseSync = execNodeScriptJson(runtime.cliPath, mapCommand("sync", monitorDataDir), runtime.cwd);

  return {
    source: "cloakbrowser",
    mode: "manual-base-safe-cycle",
    newSnapshotLines: Math.max(0, afterSnapshots - beforeSnapshots),
    batches,
    batchCount: batches.length,
    trackedPlanCreatedAt,
    rolloverDetected,
    baseSync,
    status
  };
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "cycle";
  const extraArgs = argv.slice(1);

  if (!supportedUserCommands.has(command)) {
    throw new Error(
      `Unsupported TikTok monitor plugin command: ${command}. Use one of: cycle, status, sync, setup.`
    );
  }

  if (command === "setup") {
    execNodeScript(path.join(scriptDir, "setup.mjs"), extraArgs);
    return;
  }

  const runtime = resolveRuntime(process.env.TIKTOK_MONITOR_REPO);
  const dataDir = process.env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data";
  if (command === "cycle") {
    const result = runSafeCycle(runtime, dataDir, extraArgs);
    console.log(JSON.stringify(result, null, 2));
    if (result.rolloverDetected || result.iterationLimitReached) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "sync") {
    execNodeScript(runtime.cliPath, mapCommand("sync", dataDir), runtime.cwd);
    return;
  }
  if (command === "status") {
    const result = execNodeScriptJson(runtime.cliPath, mapCommand("status", dataDir), runtime.cwd);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const commandArgs = mapCommand(command, dataDir);
  execNodeScript(runtime.cliPath, [...commandArgs, ...extraArgs], runtime.cwd);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main();
}
