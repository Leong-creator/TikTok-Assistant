import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LARK_CLI = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";

export function dedupeAlertSignals({ signals = [], previousAlerts = [], now = new Date(), ttlHours = 24 } = {}) {
  const current = new Date(now);
  const toSend = [];
  const skipped = [];

  for (const signal of signals) {
    const recent = previousAlerts
      .filter((alert) => alert.status === "sent" && alert.entityUrl === signal.entityUrl)
      .filter((alert) => hoursBetween(new Date(alert.sentAt), current) <= ttlHours)
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))[0];

    if (recent && Number(signal.score ?? 0) <= Number(recent.score ?? 0)) {
      skipped.push({ signal, reason: "duplicate alert within 24h" });
      continue;
    }
    toSend.push(signal);
  }

  return { toSend, skipped };
}

export function buildFeishuAlertText(signal) {
  const title = signal.entityType === "product" ? "热商品提醒" : "热视频提醒";
  const name = signal.accountHandle || signal.shopName || signal.title || "unknown";
  const deltaText = formatDeltaText(signal);
  return [
    `[${title}] ${name}`,
    `链接：${signal.entityUrl}`,
    `评分：${signal.score}`,
    `窗口：${signal.windowHours ?? "?"}h`,
    `增量：${deltaText}`,
    `原因：${(signal.reasons ?? []).join("；")}`,
    `建议动作：${signal.recommendedAction ?? "review"}`
  ].join("\n");
}

export function createAlertRecord({ signal, channel, recipient, result, now = new Date() }) {
  return {
    sentAt: new Date(now).toISOString(),
    channel,
    recipient,
    entityUrl: signal.entityUrl,
    signalHash: hashSignal(signal),
    score: signal.score,
    status: result?.status ?? "sent",
    messageId: result?.messageId
  };
}

export function createFeishuNotifier({
  mode = process.env.FEISHU_ALERT_MODE ?? "dm",
  dmOpenId = process.env.FEISHU_DM_OPEN_ID,
  chatId = process.env.FEISHU_ALERT_CHAT_ID,
  larkCliPath = DEFAULT_LARK_CLI,
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  return {
    async send(alert) {
      const receiveId = mode === "chat" ? chatId : dmOpenId;
      if (!receiveId) {
        return { status: "skipped", reason: `missing ${mode === "chat" ? "FEISHU_ALERT_CHAT_ID" : "FEISHU_DM_OPEN_ID"}` };
      }
      const args = [
        "im",
        "+messages-send",
        "--as",
        "bot",
        mode === "chat" ? "--chat-id" : "--user-id",
        receiveId,
        "--text",
        alert.text,
        "--idempotency-key",
        `tiktok-monitor-${hashSignal(alert.signal ?? { entityUrl: alert.text })}`
      ];
      const invocation = buildNotifierInvocation({ platform, larkCliPath, args });
      const { stdout } = await execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true });
      return { status: "sent", messageId: parseLarkMessageId(stdout) };
    }
  };
}

function buildNotifierInvocation({ platform = process.platform, larkCliPath = DEFAULT_LARK_CLI, args = [] } = {}) {
  if (platform === "win32") {
    return buildLarkCliInvocation({ platform, larkCliPath, args });
  }
  return {
    command: larkCliPath,
    args
  };
}

export function buildLarkCliInvocation({ platform = process.platform, larkCliPath = DEFAULT_LARK_CLI, args = [] } = {}) {
  if (platform === "win32") {
    const nodeEntry = resolveWindowsLarkCliNodeEntry(larkCliPath);
    if (nodeEntry) {
      return {
        command: "node",
        args: [nodeEntry, ...args]
      };
    }
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        larkCliPath,
        ...args
      ]
    };
  }
  return {
    command: larkCliPath,
    args
  };
}

function shouldQuoteWindowsCommand(command) {
  return /^[a-z]:[\\/]/iu.test(String(command ?? "")) || /[\\/]/u.test(String(command ?? ""));
}

function resolveWindowsLarkCliNodeEntry(larkCliPath) {
  const command = String(larkCliPath ?? "");
  if (!command) return undefined;
  if (/\.cmd$/iu.test(command) || /\.ps1$/iu.test(command)) {
    const candidate = path.join(path.dirname(command), "node_modules", "@larksuite", "cli", "scripts", "run.js");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const globalCandidate = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js");
  if (globalCandidate && existsSync(globalCandidate)) {
    return globalCandidate;
  }
  return undefined;
}

export function hashSignal(signal) {
  return createHash("sha256")
    .update(JSON.stringify({
      entityType: signal.entityType,
      entityUrl: signal.entityUrl,
      windowHours: signal.windowHours,
      score: signal.score,
      deltas: signal.deltas
    }))
    .digest("hex")
    .slice(0, 16);
}

function formatDeltaText(signal) {
  const deltas = signal.deltas ?? {};
  if (signal.entityType === "product") {
    return `销量 ${signed(deltas.soldCount)}，评论 ${signed(deltas.reviewCount)}，价格 ${signed(deltas.price)}`;
  }
  return `播放 ${signed(deltas.views)}，点赞 ${signed(deltas.likes)}，评论 ${signed(deltas.comments)}，分享 ${signed(deltas.shares)}`;
}

function signed(value) {
  const number = Number(value ?? 0);
  return `${number >= 0 ? "+" : ""}${number}`;
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function parseLarkMessageId(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.data?.message_id ?? parsed?.message_id;
  } catch {
    return undefined;
  }
}
