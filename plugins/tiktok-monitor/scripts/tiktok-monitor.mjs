#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");

export function mapCommand(name, monitorDataDir) {
  if (name === "cycle") {
    return [
      "monitor-cycle",
      "--source",
      "cloakbrowser",
      "--data-dir",
      monitorDataDir,
      "--max-tabs",
      "1",
      "--max-seed-videos",
      "1",
      "--max-accounts",
      "1"
    ];
  }
  if (name === "collect-batch") {
    return [
      "collect-cloakbrowser-batch",
      "--data-dir",
      monitorDataDir,
      "--max-tabs",
      "1",
      "--max-seed-videos",
      "1",
      "--max-accounts",
      "1"
    ];
  }
  if (name === "status") {
    return ["collect-status", "--data-dir", monitorDataDir];
  }
  throw new Error(`Unsupported TikTok monitor plugin command: ${name}`);
}

export function resolveRuntime(explicitRoot, cwd = process.cwd()) {
  if (explicitRoot) {
    const repoRoot = resolveMonitorRepoRoot(explicitRoot, cwd);
    return {
      cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
      cwd: repoRoot
    };
  }

  if (fs.existsSync(bundledCliPath)) {
    return {
      cliPath: bundledCliPath,
      cwd
    };
  }

  const repoRoot = resolveMonitorRepoRoot(explicitRoot, cwd);
  return {
    cliPath: path.join(repoRoot, "src", "monitor-cli.mjs"),
    cwd: repoRoot
  };
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
  execFileSync("node", [path.resolve(scriptPath), ...scriptArgs], {
    cwd,
    stdio: "inherit"
  });
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "cycle";
  const extraArgs = argv.slice(1);

  if (command === "setup") {
    execNodeScript(path.join(scriptDir, "setup.mjs"), extraArgs);
    return;
  }

  const runtime = resolveRuntime(process.env.TIKTOK_MONITOR_REPO);
  const dataDir = process.env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data";
  const commandArgs = mapCommand(command, dataDir);
  execNodeScript(runtime.cliPath, [...commandArgs, ...extraArgs], runtime.cwd);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main();
}
