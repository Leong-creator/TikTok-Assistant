import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  __setRunNodeScriptForTests,
  inspectAndPrepareSetup
} from "../plugins/tiktok-monitor/scripts/setup.mjs";

test("plugin setup auto-creates missing config templates and reports Chinese manual guidance", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-setup-missing-"));
  const cloakHome = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-home-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    __setRunNodeScriptForTests(async () => {});
    try {
      const result = await inspectAndPrepareSetup({
        cwd: repoRoot,
        env: {
          ...process.env,
          TIKTOK_MONITOR_REPO: repoRoot,
          TIKTOK_MONITOR_DATA_DIR: "monitoring_data",
          CLOAKBROWSER_HOME: cloakHome
        }
      });

      const alertConfigPath = path.join(repoRoot, "monitoring_data", "alert_config.json");
      const baseConfigPath = path.join(repoRoot, "monitoring_data", "base_dashboard_config.json");
      const whitelistConfigPath = path.join(repoRoot, "monitoring_data", "base_dashboard_whitelist_config.json");
      assert.equal(fs.existsSync(alertConfigPath), true);
      assert.equal(fs.existsSync(baseConfigPath), true);
      assert.equal(fs.existsSync(whitelistConfigPath), true);
      assert.equal(result.ready, false);
      assert.equal(result.statusCode, "needs_manual_action");
      assert.equal(result.statusCn, "还不能正式采集，请先完成以下步骤");
      assert.match(result.manualActions[0], /CloakBrowser/i);
      assert.ok(result.manualActions.some((item) => item.includes("dmOpenId")));
      assert.ok(result.manualActions.some((item) => item.includes("白名单采集所需的 baseToken")));
      assert.ok(result.autoActions.some((item) => item.name === "alertConfig"));
      assert.ok(result.autoActions.some((item) => item.name === "baseDashboardConfig"));
      assert.ok(result.autoActions.some((item) => item.name === "whitelistBaseConfig"));
    } finally {
      __setRunNodeScriptForTests(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(cloakHome, { recursive: true, force: true });
  }
});

test("plugin setup reports 可以正式采集 when runtime, profile, and configs are ready", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-setup-ready-"));
  const cloakHome = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-ready-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data"), { recursive: true });
    await mkdir(path.join(cloakHome, "source-profile", "Default"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "alert_config.json"),
      `${JSON.stringify({ dmOpenId: "ou_real_user" })}\n`
    );
    await writeFile(
      path.join(repoRoot, "monitoring_data", "base_dashboard_whitelist_config.json"),
      `${JSON.stringify({
        baseToken: "app_123",
        url: "https://example.com/base/app_123"
      })}\n`
    );

    __setRunNodeScriptForTests(async () => {});
    try {
      const result = await inspectAndPrepareSetup({
        cwd: repoRoot,
        env: {
          ...process.env,
          TIKTOK_MONITOR_REPO: repoRoot,
          TIKTOK_MONITOR_DATA_DIR: "monitoring_data",
          CLOAKBROWSER_HOME: cloakHome
        }
      });
      assert.equal(result.ready, true);
      assert.equal(result.statusCode, "ready");
      assert.equal(result.statusCn, "可以正式采集");
      assert.ok(
        result.manualActions.every((item) => item.startsWith("如需完整 dashboard/base schema 能力"))
      );
    } finally {
      __setRunNodeScriptForTests(null);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(cloakHome, { recursive: true, force: true });
  }
});

test("plugin setup can resolve the monitor repo from the project root worktree layout", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "tk-monitor-project-root-"));
  const cloakHome = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloak-root-"));
  try {
    const repoRoot = path.join(projectRoot, ".worktrees", "thread-tiktok-monitor");
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "monitoring_data"), { recursive: true });
    await mkdir(path.join(cloakHome, "source-profile", "Default"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "monitor-cli.mjs"), "export default null;\n");
    await writeFile(
      path.join(repoRoot, "monitoring_data", "alert_config.json"),
      `${JSON.stringify({ dmOpenId: "ou_real_user" })}\n`
    );
    await writeFile(
      path.join(repoRoot, "monitoring_data", "base_dashboard_whitelist_config.json"),
      `${JSON.stringify({ baseToken: "app_123" })}\n`
    );

    __setRunNodeScriptForTests(async () => {});
    try {
      const result = await inspectAndPrepareSetup({
        cwd: projectRoot,
        env: {
          ...process.env,
          TIKTOK_MONITOR_DATA_DIR: "monitoring_data",
          CLOAKBROWSER_HOME: cloakHome
        }
      });
      assert.equal(result.repoRoot, repoRoot);
      assert.equal(result.ready, true);
      assert.equal(result.statusCn, "可以正式采集");
    } finally {
      __setRunNodeScriptForTests(null);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(cloakHome, { recursive: true, force: true });
  }
});
