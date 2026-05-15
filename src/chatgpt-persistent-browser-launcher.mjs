#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createHeadedChatGptLaunchOptions,
  loadPlaywright,
  startPersistentChromeContext
} from "./persistent-browser-runtime.mjs";

const args = parseArgs(process.argv.slice(2));
const statusFile = requireArg(args["status-file"], "--status-file");
const sourceProfileDir = requireArg(args["source-profile-dir"], "--source-profile-dir");
const runProfileDir = requireArg(args["run-profile-dir"], "--run-profile-dir");
const url = args.url ?? "https://chatgpt.com/";
const channel = args.channel ?? "chrome";
const logFile = args["log-file"];

let context;

try {
  const playwright = loadPlaywright();
  context = await startPersistentChromeContext({
    playwright,
    profileDir: runProfileDir,
    sourceProfileDir,
    headless: false,
    channel,
    acceptDownloads: createHeadedChatGptLaunchOptions().acceptDownloads
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await mkdir(path.dirname(statusFile), { recursive: true });
  await writeJson(statusFile, {
    status: "ready",
    pid: process.pid,
    readyAt: new Date().toISOString(),
    mode: "headed",
    backend: "playwright-persistent-headed",
    sourceProfileDir: path.resolve(sourceProfileDir),
    runProfileDir: path.resolve(runProfileDir),
    url,
    channel
  });
  if (logFile) {
    await mkdir(path.dirname(logFile), { recursive: true });
    await appendFile(logFile, `${new Date().toISOString()} READY ${url}\n`, "utf8");
  }
  console.log("READY_FOR_LOGIN");
  await new Promise(() => {});
} catch (error) {
  await mkdir(path.dirname(statusFile), { recursive: true });
  await writeJson(statusFile, {
    status: "failed",
    pid: process.pid,
    failedAt: new Date().toISOString(),
    mode: "headed",
    backend: "playwright-persistent-headed",
    sourceProfileDir: path.resolve(sourceProfileDir),
    runProfileDir: path.resolve(runProfileDir),
    url,
    channel,
    error: error instanceof Error ? error.message : String(error)
  });
  if (logFile) {
    await mkdir(path.dirname(logFile), { recursive: true });
    await appendFile(
      logFile,
      `${new Date().toISOString()} FAILED ${url} ${error instanceof Error ? error.message : String(error)}\n`,
      "utf8"
    );
  }
  throw error;
} finally {
  if (context) {
    await context.close().catch(() => {});
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function requireArg(value, name) {
  if (!value || value === true) throw new Error(`${name} is required`);
  return value;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}
