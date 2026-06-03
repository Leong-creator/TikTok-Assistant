#!/usr/bin/env node
import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { startScriptWorkflow } from "./app-tools.mjs";
import { buildOperatorDashboardData } from "./monitor/operator-dashboard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_URI = "ui://tiktok-producer/widget.html";

export const TOOL_DEFINITIONS = [
  {
    name: "start_script_workflow",
    title: "开始制作",
    description:
      "粘贴一条短视频脚本后调用此工具。它会准备首段钩子预检、ChatGPT 首帧图任务和即梦图生视频人工任务；用户不需要填写阶段、类型或文件名。",
    inputSchema: {
      script: z.string(),
      productName: z.string().optional(),
      notes: z.string().optional(),
      outputRoot: z.string().optional()
    },
    handler: startScriptWorkflow,
    meta: {
      ui: { resourceUri: WIDGET_URI }
    }
  }
];

export async function loadWidgetHtml() {
  return readFile(path.resolve(__dirname, "../public/tiktok-producer-widget.html"), "utf8");
}

export async function loadMonitorDashboardHtml() {
  return readFile(path.resolve(__dirname, "../public/tiktok-monitor-dashboard.html"), "utf8");
}

export function createTikTokProducerServer() {
  const server = new McpServer({ name: "tiktok-material-assistant-app", version: "0.1.0" });
  registerAppResource(
    server,
    "TikTok素材制作助手",
    WIDGET_URI,
    {
      description: "TikTok 内容生产 App 操作界面"
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadWidgetHtml()
        }
      ]
    })
  );

  for (const definition of TOOL_DEFINITIONS) {
    registerAppTool(
      server,
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        _meta: definition.meta ?? {
          ui: { resourceUri: WIDGET_URI }
        }
      },
      async (args) => {
        const result = await definition.handler(args ?? {});
        return {
          content: [{ type: "text", text: result.status ?? "已完成" }],
          structuredContent: result
        };
      }
    );
  }

  return server;
}

export function createHttpServer() {
  return createServer(async (req, res) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      logHttpRequest({
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: req.headers["user-agent"],
        cfRay: req.headers["cf-ray"]
      }).catch(() => {});
    });

    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("TikTok素材制作助手 MCP server");
      return;
    }

    if (req.method === "GET" && url.pathname === "/monitor-dashboard") {
      const html = await loadMonitorDashboardHtml();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/monitor-dashboard") {
      writeCors(res);
      try {
        const dataDir = String(url.searchParams.get("dataDir") ?? "monitoring_data");
        const data = await buildOperatorDashboardData({ dataDir });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(data));
      } catch (error) {
        res
          .writeHead(500, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/privacy") {
      res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end(
          [
            "TikTok素材制作助手隐私说明",
            "",
            "本工具用于把用户提供的短视频脚本保存到本地项目目录，并生成首段钩子预检和人工制作清单。",
            "本工具不收集账号密码、Cookie、支付信息或浏览器会话凭据。",
            "脚本内容和生成的制作清单会写入用户本机的 TikTok Project outputs 目录。",
            "测试阶段不会主动生成图片、生成视频或调用第三方付费服务。即梦图生视频需要人工确认后执行。"
          ].join("\n")
        );
      return;
    }

    if (req.method === "OPTIONS" && (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/api/"))) {
      writeCors(res);
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === "/api/start-script-workflow" && req.method === "POST") {
      writeCors(res);
      try {
        const body = await readJsonBody(req);
        await logActionRequest({ status: "received", body });
        const result = await startScriptWorkflow(body);
        await logActionRequest({ status: "completed", packageDir: result.packageDir });
        res
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify(toGptActionResponse(result)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        await logActionRequest({ status: "failed", error: message }).catch(() => {});
        const status = /script is required/u.test(message) ? 400 : 500;
        res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: message }));
      }
      return;
    }

    if (url.pathname === "/mcp" && ["POST", "GET", "DELETE"].includes(req.method ?? "")) {
      writeCors(res);
      const server = createTikTokProducerServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500).end(error instanceof Error ? error.message : "Internal server error");
        }
      }
      return;
    }

    res.writeHead(404).end("Not Found");
  });
}

export function startHttpServer({ port = Number(process.env.PORT ?? 8787) } = {}) {
  const server = createHttpServer();
  server.listen(port, () => {
    console.log(`TikTok素材制作助手 MCP server listening on http://localhost:${port}/mcp`);
  });
  return server;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function logActionRequest(entry) {
  const logPath = path.resolve("outputs/action_requests.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n", "utf8");
}

async function logHttpRequest(entry) {
  const logPath = path.resolve("outputs/http_requests.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n", "utf8");
}

function toGptActionResponse(result) {
  return {
    status: "ok",
    message: "已创建首段钩子预检包。本次只准备 ChatGPT 生图任务和即梦图生视频人工任务，不自动生成图片或视频。",
    packageDir: result.packageDir,
    stageName: "首段钩子预检",
    finalCountStatus: "未确认；先审核前 30 秒到 1 分钟，再决定是否继续全量。",
    generatedMedia: "none",
    nextAction: "请在 ChatGPT 对话中输出中文钩子判断、首帧图 prompt、即梦图生视频 prompt 和钩子自审结果。"
  };
}

function writeCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
