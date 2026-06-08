#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { inspectAndPrepareSetup } from "../scripts/setup.mjs";

const payload = await readHookPayload();
const cwd = typeof payload?.cwd === "string" && payload.cwd.trim() ? payload.cwd.trim() : process.cwd();
const repoRoot = findRelevantMonitorRepoRoot(cwd, process.env.TIKTOK_MONITOR_REPO);

if (!repoRoot) {
  process.exit(0);
}

const result = await inspectAndPrepareSetup({
  cwd: repoRoot,
  env: {
    ...process.env,
    TIKTOK_MONITOR_REPO: repoRoot
  },
  autoFix: false
});

const blockingManualActions = result.manualActions.filter((item) => !item.startsWith("如需"));
if (result.ready || (result.statusCode !== "failed" && blockingManualActions.length === 0)) {
  process.exit(0);
}

const message = `${result.statusCn}：${blockingManualActions.join("；")}`;
process.stdout.write(JSON.stringify({
  systemMessage: `TikTok monitor 环境检查：${message}`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: `如果本次要运行 TikTok monitor，请先完成这些步骤：${blockingManualActions.join("；")}`
  }
}));

async function readHookPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (!chunks.length) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findRelevantMonitorRepoRoot(startCwd, explicitRoot) {
  const candidates = [];
  if (explicitRoot) {
    candidates.push(path.resolve(explicitRoot));
  }
  let current = path.resolve(startCwd);
  for (let index = 0; index < 6; index += 1) {
    candidates.push(current);
    candidates.push(path.join(current, ".worktrees", "thread-tiktok-monitor"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  for (const candidate of candidates) {
    if (isMonitorRepo(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isMonitorRepo(candidate) {
  return fs.existsSync(path.join(candidate, "src", "monitor-cli.mjs"));
}
