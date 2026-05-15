import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mapCommand,
  resolveMonitorRepoRoot,
  resolveRuntime
} from "../plugins/tiktok-monitor/scripts/tiktok-monitor.mjs";

test("plugin command mapping keeps formal cobrowser monitor entrypoints", () => {
  assert.deepEqual(mapCommand("cycle", "monitoring_data"), [
    "monitor-cycle",
    "--source",
    "cobrowser",
    "--data-dir",
    "monitoring_data"
  ]);
  assert.deepEqual(mapCommand("collect-batch", "monitoring_data"), [
    "collect-cobrowser-batch",
    "--data-dir",
    "monitoring_data"
  ]);
  assert.deepEqual(mapCommand("status", "monitoring_data"), [
    "collect-status",
    "--data-dir",
    "monitoring_data"
  ]);
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
