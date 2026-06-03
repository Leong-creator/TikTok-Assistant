import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TOOL_DEFINITIONS, createHttpServer, loadMonitorDashboardHtml, loadWidgetHtml } from "../src/app-server.mjs";

test("TikTok素材制作助手 MCP server exposes only the script-first operator tool to ChatGPT", () => {
  assert.deepEqual(
    TOOL_DEFINITIONS.map((tool) => tool.name),
    ["start_script_workflow"]
  );
  assert.equal(TOOL_DEFINITIONS[0].title, "开始制作");
  assert.match(TOOL_DEFINITIONS[0].description, /粘贴/);
  assert.ok(TOOL_DEFINITIONS.every((tool) => tool.inputSchema));
});

test("TikTok素材制作助手 widget is a functional ChatGPT App component", async () => {
  const html = await loadWidgetHtml();
  assert.match(html, /TikTok素材制作助手/);
  assert.match(html, /window\.parent\.postMessage/);
  assert.match(html, /start_script_workflow/);
  assert.match(html, /开始制作/);
  assert.match(html, /粘贴脚本/);
  assert.match(html, /首段钩子预检/);
  assert.doesNotMatch(html, /prepare_provider_tasks/);
  assert.doesNotMatch(html, /slug/);
  assert.doesNotMatch(html, /storyCategory/);
  assert.doesNotMatch(html, /阶段/);
});

test("operator dashboard page is available as a local monitoring workspace", async () => {
  const html = await loadMonitorDashboardHtml();
  assert.match(html, /同行新爆雷达/);
  assert.match(html, /今天新爆视频 TOP3/);
  assert.match(html, /近7天可直接抄 TOP3/);
  assert.match(html, /近3个月主题参考 TOP3/);
  assert.match(html, /今天要盯的账号 TOP3/);
  assert.match(html, /先按主题翻素材/);
  assert.match(html, /账号素材池/);
  assert.match(html, /主题素材池/);
  assert.match(html, /视频总库/);
  assert.match(html, /hero-brief/);
  assert.match(html, /hero-lead/);
  assert.match(html, /theme-spotlight/);
  assert.match(html, /video-wall/);
  assert.doesNotMatch(html, /<tbody id="accountVideos">/);
  assert.match(html, /\/api\/monitor-dashboard/);
});

test("GPT Action REST endpoint starts the same script workflow without exposing technical inputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-action-"));
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/start-script-workflow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script: "A retired teacher found an old notebook. It taught a child three rules about money.",
        productName: "Parenting Book",
        notes: "只验证流程，不生成图片或视频",
        outputRoot: root
      })
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.status, "ok");
    assert.equal(json.stageName, "首段钩子预检");
    assert.match(json.finalCountStatus, /30 秒到 1 分钟/);
    assert.equal(json.generatedMedia, "none");
    assert.ok(json.packageDir.startsWith(root));
    assert.doesNotMatch(JSON.stringify(json), /provider|slug|storyCategory|productCategory|mode|totalShots|keyImages|batchImages/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("privacy endpoint is available for GPT Action configuration", async () => {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/privacy`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /TikTok素材制作助手/);
    assert.match(text, /不收集账号密码/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("monitor dashboard API returns operator summary for a provided monitoring_data dir", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-dashboard-api-"));
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", sourceQueries: ["people skills"] }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
        accountHandle: "book_alpha",
        signalKind: "new_breakout",
        signalLabel: "3天内新爆",
        current: { videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990", postedAt: "2026-05-20T08:00:00.000Z", views: 12000, likes: 1500, comments: 80, shares: 130 },
        currentMetrics: { views: 12000, likes: 1500, comments: 80, shares: 130 },
        deltas: { views: 3000, likes: 400, comments: 20, shares: 40 },
        score: 88,
        detectedAt: "2026-05-21T10:00:00.000Z"
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-21T11:00:00.000Z",
        accountHandle: "book_alpha",
        videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
        postedAt: "2026-05-20T08:00:00.000Z",
        caption: "People Skills can save your child years of mistakes",
        views: 12000,
        likes: 1500,
        comments: 80,
        shares: 130
      }) + "\n"
    );
    const response = await fetch(`http://127.0.0.1:${port}/api/monitor-dashboard?dataDir=${encodeURIComponent(dataDir)}`);
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.cards.length, 4);
    assert.equal(json.mustWatch[0].accountHandle, "book_alpha");
    assert.equal(json.accountRank[0].handle, "book_alpha");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
