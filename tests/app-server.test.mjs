import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TOOL_DEFINITIONS, createHttpServer, loadWidgetHtml } from "../src/app-server.mjs";

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
