import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";

const hookScript = path.resolve("plugins/tiktok-monitor/hooks/session-start-setup-check.mjs");

test("session-start hook stays silent outside a relevant monitor workspace", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tk-monitor-hook-irrelevant-"));
  try {
    const result = await runHook(cwd, {
      hook_event_name: "SessionStart",
      source: "startup",
      cwd
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("session-start hook warns in Chinese when the monitor workspace is not ready", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-hook-project-"));
  try {
    const repoRoot = path.join(projectRoot, ".worktrees", "thread-tiktok-monitor");
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    assert.equal(existsSync(path.join(repoRoot, "monitoring_data")), false);

    const result = await runHook(projectRoot, {
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: projectRoot
    });
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.match(parsed.systemMessage, /还不能正式采集|初始化失败/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /请先完成这些步骤/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function runHook(cwd, payload) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}
