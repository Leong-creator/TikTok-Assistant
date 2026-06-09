#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectAndPrepareSetup } from "./setup.mjs";
import { main as runPluginCommand } from "./tiktok-monitor.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const version = manifest.version || "0.1.0";
const supportedCommands = new Set(["cycle", "status", "sync", "setup", "doctor", "help", "--help", "-h", "version", "--version", "-v"]);

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "help";
  if (!supportedCommands.has(command)) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(version);
    return;
  }

  if (command === "setup" || command === "doctor") {
    const setupArgv = command === "doctor" ? argv.slice(1) : argv;
    const setup = await inspectAndPrepareSetup({
      cwd: process.cwd(),
      env: process.env,
      autoFix: !setupArgv.includes("--check-only")
    });
    console.log(JSON.stringify({
      ok: setup.ready,
      command,
      setup
    }, null, 2));
    if (setup.statusCode === "failed") {
      process.exitCode = 1;
    }
    return;
  }

  const setup = await inspectAndPrepareSetup({
    cwd: process.cwd(),
    env: process.env,
    autoFix: true
  });

  if ((command === "cycle" || command === "sync") && !setup.ready) {
    printSetupFailure(command, setup);
    process.exitCode = 1;
    return;
  }

  if (command === "status" && setup.statusCode === "failed") {
    printSetupFailure(command, setup);
    process.exitCode = 1;
    return;
  }

  if (command === "status" && !setup.ready) {
    console.error(`[tiktok-monitor] ${setup.statusCn}`);
    for (const step of setup.nextStepsCn ?? []) {
      console.error(`[tiktok-monitor] ${step}`);
    }
  }

  runPluginCommand(argv);
}

function printHelp() {
  console.log([
    "TikTok monitor launcher",
    "",
    "Usage:",
    "  tiktok-monitor cycle",
    "  tiktok-monitor cycle --background",
    "  tiktok-monitor status",
    "  tiktok-monitor sync",
    "  tiktok-monitor setup",
    "  tiktok-monitor doctor",
    "",
    "Notes:",
    "  cycle/sync will auto-run readiness checks first.",
    "  If TikTok login or Base config is still missing, the launcher prints Chinese guidance and stops."
  ].join("\n"));
}

function printSetupFailure(command, setup) {
  console.error(`[tiktok-monitor] 无法执行 ${command}：${setup.statusCn}`);
  for (const step of setup.nextStepsCn ?? []) {
    console.error(`[tiktok-monitor] ${step}`);
  }
  console.log(JSON.stringify({
    ok: false,
    command,
    setup
  }, null, 2));
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isEntryPoint) {
  await main();
}
