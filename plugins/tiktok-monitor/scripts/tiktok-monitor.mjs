#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const command = args[0] ?? "cycle";
const extraArgs = args.slice(1);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");

if (command === "setup") {
  execNodeScript(path.join(scriptDir, "setup.mjs"), extraArgs);
  process.exit(0);
}

const runtime = resolveRuntime(process.env.TIKTOK_MONITOR_REPO);
const dataDir = process.env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data";

const commandArgs = mapCommand(command, dataDir);
execNodeScript(runtime.cliPath, [...commandArgs, ...extraArgs], runtime.cwd);

function mapCommand(name, monitorDataDir) {
  if (name === "cycle") {
    return ["monitor-cycle", "--source", "cobrowser", "--data-dir", monitorDataDir];
  }
  if (name === "collect-batch") {
    return ["collect-cobrowser-batch", "--data-dir", monitorDataDir];
  }
  if (name === "status") {
    return ["collect-status", "--data-dir", monitorDataDir];
  }
  throw new Error(`Unsupported TikTok monitor plugin command: ${name}`);
}

function resolveRuntime(explicitRoot) {
  if (fs.existsSync(bundledCliPath)) {
    return {
      cliPath: bundledCliPath,
      cwd: process.cwd()
    };
  }

  const repoRoot = resolveMonitorRepoRoot(explicitRoot);
  return {
    cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
    cwd: repoRoot
  };
}

function resolveMonitorRepoRoot(explicitRoot) {
  const candidates = [];
  if (explicitRoot) candidates.push(explicitRoot);
  candidates.push(process.cwd());

  let current = path.resolve(process.cwd());
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
  execFileSync("node", [path.resolve(scriptPath), ...scriptArgs], {
    cwd,
    stdio: "inherit"
  });
}
