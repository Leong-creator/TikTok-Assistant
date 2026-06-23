#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");
let execFileSyncImpl = execFileSync;
let spawnImpl = spawn;
let pidCheckImpl = defaultPidCheck;
const supportedUserCommands = new Set(["cycle", "status", "sync", "setup"]);
const backgroundCycleFlag = "--background";
const forceRefreshPlanFlag = "--force-refresh-plan";
const managedCycleStateFile = "tiktok-monitor-cycle-state.json";
const managedCycleLogFile = "tiktok-monitor-cycle.log";
const execJsonMaxBuffer = 16 * 1024 * 1024;
const retryableChildExitStatuses = new Set([3221225786]);

export function __setExecFileSyncForTests(fn) {
  execFileSyncImpl = fn ?? execFileSync;
}

export function __setSpawnForTests(fn) {
  spawnImpl = fn ?? spawn;
}

export function __setPidCheckForTests(fn) {
  pidCheckImpl = fn ?? defaultPidCheck;
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
    stdio: "inherit",
    windowsHide: true
  });
}

function execNodeScriptJson(scriptPath, scriptArgs = [], cwd = process.cwd()) {
  const stdout = execFileSyncImpl("node", [path.resolve(scriptPath), ...scriptArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: execJsonMaxBuffer,
    windowsHide: true
  });
  return parseJsonFromPossiblyNoisyStdout(stdout);
}

function parseJsonFromPossiblyNoisyStdout(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    throw new Error("Expected JSON output but received empty stdout.");
  }
  try {
    return JSON.parse(text);
  } catch {
    const sanitized = stripKnownNoiseLines(text);
    const candidate = extractTrailingJsonBlock(sanitized);
    return JSON.parse(candidate);
  }
}

function stripKnownNoiseLines(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .filter((line) => !/^\[cloakbrowser\]/iu.test(String(line).trim()))
    .join("\n")
    .trim();
}

function extractTrailingJsonBlock(text) {
  const trimmed = String(text ?? "").trim();
  const objectStart = trimmed.lastIndexOf("\n{");
  const arrayStart = trimmed.lastIndexOf("\n[");
  const start = Math.max(objectStart, arrayStart);
  if (start >= 0) {
    return trimmed.slice(start + 1).trim();
  }
  const braceStart = trimmed.search(/[\[{]/u);
  if (braceStart >= 0) {
    return trimmed.slice(braceStart).trim();
  }
  return trimmed;
}

function readCycleStatus(runtime, monitorDataDir) {
  return execNodeScriptJson(runtime.cliPath, mapCommand("status", monitorDataDir), runtime.cwd);
}

function readManualBaseSyncState(runtimeCwd, dataDir) {
  const statePath = path.join(runtimeCwd, dataDir, "state", "manual_base_sync_state.json");
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function summarizeCollectionScope({ status, baseSyncState, batches = [] } = {}) {
  const planCounts = status?.plan?.counts ?? {};
  const batchPlanned = batches.find((batch) => batch?.planned)?.planned ?? null;
  const collectorPlannedVideoTargets = Number(
    batchPlanned?.videoTargets ?? planCounts.videoTargets ?? 0
  );
  return {
    accountTargets: Number(planCounts.accountTargets ?? planCounts.accounts ?? 0),
    currentPlanVideoTargets: Number(planCounts.videoTargets ?? 0),
    archiveVideoCount: Number(baseSyncState?.counts?.archive ?? 0),
    likesBoardCount: Number(baseSyncState?.counts?.likes ?? 0),
    incrementBoardCount: Number(baseSyncState?.counts?.increments ?? 0),
    collectorPlannedVideoTargets
  };
}

function shouldResumeCurrentPlan(status) {
  return Boolean(
    status?.plan?.createdAt &&
      status?.cursor &&
      status.cursor.completed === false &&
      ((status.plan?.counts?.accountTargets ?? 0) > 0 || (status.plan?.counts?.videoTargets ?? 0) > 0)
  );
}

function defaultPidCheck(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function splitCycleArgs(extraArgs = []) {
  const pluginArgs = {
    background: false,
    forceRefreshPlan: false
  };
  const batchArgs = [];
  for (const arg of extraArgs) {
    if (arg === backgroundCycleFlag) {
      pluginArgs.background = true;
      continue;
    }
    if (arg === forceRefreshPlanFlag) {
      pluginArgs.forceRefreshPlan = true;
      continue;
    }
    batchArgs.push(arg);
  }
  return { pluginArgs, batchArgs };
}

export function getManagedCycleArtifacts(runtimeCwd, dataDir) {
  const runtimeDir = path.join(runtimeCwd, ".runtime");
  const statePath = path.join(runtimeDir, managedCycleStateFile);
  const logPath = path.join(runtimeDir, managedCycleLogFile);
  return {
    runtimeDir,
    statePath,
    logPath,
    dataDir
  };
}

export function readManagedCycleState(runtimeCwd, dataDir) {
  const { statePath } = getManagedCycleArtifacts(runtimeCwd, dataDir);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeManagedCycleState(runtimeCwd, dataDir, state) {
  const artifacts = getManagedCycleArtifacts(runtimeCwd, dataDir);
  fs.mkdirSync(artifacts.runtimeDir, { recursive: true });
  fs.writeFileSync(artifacts.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return artifacts.statePath;
}

function describeManagedCycleState(runtimeCwd, dataDir) {
  const state = readManagedCycleState(runtimeCwd, dataDir);
  if (!state) {
    return null;
  }
  return {
    ...state,
    active: state.status === "running" && pidCheckImpl(state.pid)
  };
}

export function startManagedBackgroundCycle(runtime, monitorDataDir, batchArgs = [], options = {}) {
  const artifacts = getManagedCycleArtifacts(runtime.cwd, monitorDataDir);
  const existingState = describeManagedCycleState(runtime.cwd, monitorDataDir);
  if (existingState?.active) {
    const status = readCycleStatus(runtime, monitorDataDir);
    const baseSyncState = readManualBaseSyncState(runtime.cwd, monitorDataDir);
    return {
      mode: "managed-background-cycle",
      started: false,
      alreadyRunning: true,
      managedCycle: existingState,
      status,
      scope: summarizeCollectionScope({ status, baseSyncState })
    };
  }

  fs.mkdirSync(artifacts.runtimeDir, { recursive: true });
  const stdoutFd = fs.openSync(artifacts.logPath, "a");
  const workerScript = path.join(scriptDir, "tiktok-monitor-cycle-worker.mjs");
  const child = spawnImpl(
    process.execPath,
    [
      workerScript,
      "--repo-root",
      runtime.cwd,
      "--data-dir",
      monitorDataDir,
      ...(options.forceRefreshPlan ? [forceRefreshPlanFlag] : []),
      ...batchArgs
    ],
    {
      cwd: runtime.cwd,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stdoutFd],
      env: {
        ...process.env,
        TIKTOK_MONITOR_REPO: runtime.cwd,
        TIKTOK_MONITOR_DATA_DIR: monitorDataDir
      }
    }
  );
  child.unref?.();

  writeManagedCycleState(runtime.cwd, monitorDataDir, {
    mode: "managed-background-cycle",
    status: "running",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repoRoot: runtime.cwd,
    dataDir: monitorDataDir,
    forceRefreshPlan: Boolean(options.forceRefreshPlan),
    batchArgs,
    logPath: artifacts.logPath
  });

  const status = readCycleStatus(runtime, monitorDataDir);
  const baseSyncState = readManualBaseSyncState(runtime.cwd, monitorDataDir);
  return {
    mode: "managed-background-cycle",
    started: true,
    alreadyRunning: false,
    managedCycle: describeManagedCycleState(runtime.cwd, monitorDataDir),
    status,
    scope: summarizeCollectionScope({ status, baseSyncState })
  };
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

export function runSafeCycle(runtime, monitorDataDir, extraArgs = [], maxIterations = 1000, options = {}) {
  const beforeSnapshots = countSnapshotLines(monitorDataDir, runtime.cwd);
  const batches = [];
  const initialStatus = readCycleStatus(runtime, monitorDataDir);
  let refreshPlan = options.forceRefreshPlan ? true : !shouldResumeCurrentPlan(initialStatus);
  let trackedPlanCreatedAt = null;
  let rolloverDetected = false;
  let rolloverCursor = null;
  let cycleCompleted = false;

  if (!refreshPlan) {
    trackedPlanCreatedAt = initialStatus.cursor?.planCreatedAt ?? null;
  }

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
  const status = readCycleStatus(runtime, monitorDataDir);
  const baseSyncStateBeforeSync = readManualBaseSyncState(runtime.cwd, monitorDataDir);
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
      status,
      scope: summarizeCollectionScope({
        status,
        baseSyncState: baseSyncStateBeforeSync,
        batches
      })
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
      status,
      scope: summarizeCollectionScope({
        status,
        baseSyncState: baseSyncStateBeforeSync,
        batches
      })
    };
  }
  const baseSync = runBaseSyncWithRetry(runtime, monitorDataDir, options);
  const baseSyncStateAfterSync = readManualBaseSyncState(runtime.cwd, monitorDataDir);

  return {
    source: "cloakbrowser",
    mode: "manual-base-safe-cycle",
    newSnapshotLines: Math.max(0, afterSnapshots - beforeSnapshots),
    batches,
    batchCount: batches.length,
    trackedPlanCreatedAt,
    rolloverDetected,
    baseSync,
    status,
    scope: summarizeCollectionScope({
      status,
      baseSyncState: baseSyncStateAfterSync,
      batches
    })
  };
}

function runBaseSyncWithRetry(runtime, monitorDataDir, options = {}) {
  const retries = Number.isInteger(options.baseSyncRetries) ? options.baseSyncRetries : 2;
  const delayMs = Number.isFinite(options.baseSyncRetryDelayMs) ? options.baseSyncRetryDelayMs : 1500;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return execNodeScriptJson(runtime.cliPath, mapCommand("sync", monitorDataDir), runtime.cwd);
    } catch (error) {
      lastError = error;
      if (!isRetryableChildExit(error) || attempt === retries) {
        throw error;
      }
      sleepSync(delayMs);
    }
  }
  throw lastError;
}

function isRetryableChildExit(error) {
  return retryableChildExitStatuses.has(Number(error?.status));
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function main(argv = process.argv.slice(2)) {
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
    const { pluginArgs, batchArgs } = splitCycleArgs(extraArgs);
    const result = pluginArgs.background
      ? startManagedBackgroundCycle(runtime, dataDir, batchArgs, {
          forceRefreshPlan: pluginArgs.forceRefreshPlan
        })
      : runSafeCycle(runtime, dataDir, batchArgs, 1000, {
          forceRefreshPlan: pluginArgs.forceRefreshPlan
        });
    console.log(JSON.stringify(result, null, 2));
    if (!pluginArgs.background && (result.rolloverDetected || result.iterationLimitReached)) {
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
    result.managedCycle = describeManagedCycleState(runtime.cwd, dataDir);
    result.scope = summarizeCollectionScope({
      status: result,
      baseSyncState: readManualBaseSyncState(runtime.cwd, dataDir)
    });
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
