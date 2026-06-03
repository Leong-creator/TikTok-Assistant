import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("monitor CLI run-once executes mock account and shop monitoring without sending real Feishu messages", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          lastKnownPostAt: "2026-05-09T01:00:00.000Z",
          enabled: true
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "shops.json"),
      JSON.stringify([
        {
          id: "shop-alpha",
          name: "Alpha Books",
          shopUrl: "https://www.tiktok.com/shop/alpha",
          enabled: true
        }
      ])
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "run-once",
        "--source",
        "mock",
        "--targets",
        "accounts,shops",
        "--data-dir",
        dataDir,
        "--alert-recipient",
        "ou_test_user",
        "--dry-run-alerts"
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.source, "mock");
    assert.ok(result.snapshots.video > 0);
    assert.ok(result.snapshots.product > 0);
    assert.ok(result.alerts.sent > 0);

    const alerts = (await readFile(path.join(dataDir, "alerts", "alerts.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(alerts.every((alert) => alert.channel === "feishu-dm"));
    assert.ok(alerts.every((alert) => alert.recipient === "ou_test_user"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI imports Feishu wiki seeds from exported file fallback", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-seed-"));
  try {
    const exportPath = path.join(dataDir, "wiki-export.txt");
    await writeFile(exportPath, "https://www.tiktok.com/@book_alpha\nhttps://www.tiktok.com/shop/alpha-books\n");

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "seed",
        "import-feishu",
        "--url",
        "https://gah4srxbgfr.feishu.cn/wiki/example",
        "--from-file",
        exportPath,
        "--data-dir",
        dataDir
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.source, "file");
    assert.equal(result.accounts, 1);
    assert.equal(result.shops, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI rejects Feishu group alerts in private-message test phase", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-alert-"));
  try {
    await assert.rejects(
      () =>
        execFileAsync(
          "node",
          [
            "src/monitor-cli.mjs",
            "alert",
            "--channel",
            "feishu-chat",
            "--alert-recipient",
            "oc_test_chat",
            "--data-dir",
            dataDir,
            "--dry-run-alerts"
          ],
          { cwd: path.resolve(".") }
        ),
      /group alerts are disabled/i
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI base-sync dry-run emits Feishu Base upsert commands", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-base-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "base-sync",
        "--data-dir",
        dataDir,
        "--base-token",
        "app_test",
        "--table-map",
        JSON.stringify({ accounts: "tbl_accounts" }),
        "--dry-run"
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.dryRun, true);
    assert.equal(result.commands.length, 1);
    assert.deepEqual(result.commands[0].args.slice(0, 2), ["base", "+record-upsert"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI seed merge-runs consolidates historical seed folders into the main data dir", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-merge-"));
  try {
    const runOne = path.join(dataDir, "chrome_52_incremental");
    const runTwo = path.join(dataDir, "chrome_profile_grid_20260509");
    await mkdir(path.join(runOne, "seeds"), { recursive: true });
    await mkdir(path.join(runTwo, "seeds"), { recursive: true });
    await writeFile(
      path.join(runOne, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(
      path.join(runOne, "seeds", "videos.json"),
      JSON.stringify([{ videoUrl: "https://www.tiktok.com/@book_alpha/video/1", enabled: true }])
    );
    await writeFile(
      path.join(runTwo, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_beta", profileUrl: "https://www.tiktok.com/@book_beta", enabled: true }])
    );
    await writeFile(
      path.join(runTwo, "seeds", "shops.json"),
      JSON.stringify([{ shopUrl: "https://www.tiktok.com/shop/book-beta", enabled: true }])
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "seed",
        "merge-runs",
        "--data-dir",
        dataDir
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.sourceRuns, 2);
    assert.equal(result.target.accounts, 2);
    assert.equal(result.target.shops, 1);
    assert.equal(result.target.videos, 1);

    const mergedAccounts = JSON.parse(await readFile(path.join(dataDir, "seeds", "accounts.json"), "utf8"));
    assert.deepEqual(
      mergedAccounts.map((item) => item.handle),
      ["book_alpha", "book_beta"]
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI seed promote-candidates moves candidate accounts into the formal tracking pool", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-promote-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify([
        {
          id: "candidate-book_beta",
          handle: "book_beta",
          profileUrl: "https://www.tiktok.com/@book_beta",
          status: "candidate",
          sourceQuery: "people skills"
        }
      ])
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "seed",
        "promote-candidates",
        "--data-dir",
        dataDir
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.promoted, 1);
    const accounts = JSON.parse(await readFile(path.join(dataDir, "seeds", "accounts.json"), "utf8"));
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].handle, "book_beta");
    assert.equal(accounts[0].enabled, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI report sends a summarized Feishu DM payload without real network calls", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-report-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "report",
        "--data-dir",
        dataDir,
        "--alert-recipient",
        "ou_test_user",
        "--dry-run-alerts"
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.summary.trackedAccounts, 1);
    assert.match(result.text, /TikTok同行晨会简报/u);
    assert.match(result.text, /监控池：账号池 1 \| 近90天视频 0/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI report falls back to monitoring_data alert_config.json for the Feishu DM recipient", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-report-config-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");
    await writeFile(
      path.join(dataDir, "alert_config.json"),
      JSON.stringify({ dmOpenId: "ou_config_user" })
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "src/monitor-cli.mjs",
        "report",
        "--data-dir",
        dataDir,
        "--dry-run-alerts"
      ],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI collect-plan and collect-status expose bounded batch state", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-plan-"));
  try {
    const validVideoUrl = "https://www.tiktok.com/@book_alpha/video/7623225588626590990";
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true,
          evidenceUrls: [validVideoUrl]
        },
        {
          id: "account-beta",
          handle: "book_beta",
          profileUrl: "https://www.tiktok.com/@book_beta",
          enabled: true
        }
      ])
    );

    const { stdout: planStdout } = await execFileAsync(
      "node",
      ["src/monitor-cli.mjs", "collect-plan", "--data-dir", dataDir],
      { cwd: path.resolve(".") }
    );
    const plan = JSON.parse(planStdout);
    assert.equal(plan.counts.videoTargets, 1);
    assert.equal(plan.counts.accountTargets, 2);

    const { stdout: statusStdout } = await execFileAsync(
      "node",
      ["src/monitor-cli.mjs", "collect-status", "--data-dir", dataDir],
      { cwd: path.resolve(".") }
    );
    const status = JSON.parse(statusStdout);
    assert.equal(status.cursor.videoIndex, 0);
    assert.equal(status.cursor.accountIndex, 0);
    assert.equal(status.plan.counts.accounts, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI usage documents cloakbrowser and other batch sources", async () => {
  const { stdout } = await execFileAsync("node", ["src/monitor-cli.mjs"], { cwd: path.resolve(".") });

  const result = JSON.parse(stdout);
  assert.match(result.usage, /collect-persistent-batch/);
  assert.match(result.usage, /collect-cobrowser-batch/);
  assert.match(result.usage, /collect-cloakbrowser-batch/);
  assert.match(result.usage, /monitor-cycle/);
  assert.match(result.usage, /--source mock\|chrome\|playwright-persistent\|cobrowser\|cloakbrowser/);
});

test("monitor CLI collect-persistent-batch completes immediately when the plan has no targets", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cli-persistent-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(path.join(dataDir, "seeds", "accounts.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "videos.json"), "[]");

    const { stdout } = await execFileAsync(
      "node",
      ["src/monitor-cli.mjs", "collect-persistent-batch", "--data-dir", dataDir],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.source, "playwright-persistent");
    assert.equal(result.batch.done, true);
    assert.equal(result.snapshots.video, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI collect-cobrowser-batch completes immediately when the plan has no targets", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cobrowser-batch-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(path.join(dataDir, "seeds", "accounts.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "videos.json"), "[]");

    const { stdout } = await execFileAsync(
      "node",
      ["src/monitor-cli.mjs", "collect-cobrowser-batch", "--data-dir", dataDir],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.source, "cobrowser");
    assert.equal(result.batch.done, true);
    assert.equal(result.snapshots.video, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monitor CLI collect-cloakbrowser-batch completes immediately when the plan has no targets", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-cloakbrowser-batch-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(path.join(dataDir, "seeds", "accounts.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]");
    await writeFile(path.join(dataDir, "seeds", "videos.json"), "[]");

    const { stdout } = await execFileAsync(
      "node",
      ["src/monitor-cli.mjs", "collect-cloakbrowser-batch", "--data-dir", dataDir],
      { cwd: path.resolve(".") }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.source, "cloakbrowser");
    assert.equal(result.batch.done, true);
    assert.equal(result.snapshots.video, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
