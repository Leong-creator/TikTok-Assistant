import { readdir } from "node:fs/promises";
import path from "node:path";

import { analyzeVideoSnapshots } from "./analyzer.mjs";
import { appendJsonLines, ensureMonitorDataDirs, readJsonFile, readJsonLines } from "./storage.mjs";

export async function buildMonitorReport({
  dataDir = "monitoring_data",
  now = new Date(),
  recentWindowHours = 24,
  maxSignals = 5,
  baseUrl
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const accounts = await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const accountCandidates = await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []);
  const shops = await readJsonFile(path.join(dataDir, "seeds", "shops.json"), []);
  const rootSignals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const rootVideoSnapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const historicalSignals = rootSignals.length ? [] : await loadHistoricalJsonLines({ dataDir, filePath: ["signals", "signals.jsonl"] });
  const historicalVideoSnapshots = rootVideoSnapshots.length ? [] : await loadHistoricalJsonLines({ dataDir, filePath: ["snapshots", "video_snapshots.jsonl"] });
  const dashboardConfig = await readJsonFile(path.join(dataDir, "base_dashboard_config.json"), {});
  const current = new Date(now);
  const resolvedBaseUrl = baseUrl ?? dashboardConfig?.url;
  const videoSnapshots = rootVideoSnapshots.length ? rootVideoSnapshots : historicalVideoSnapshots;
  const signals = rootSignals.length ? rootSignals : historicalSignals;
  const derivedSignals = signals.length
    ? []
    : analyzeVideoSnapshots(
        videoSnapshots.filter((snapshot) => /tiktok\.com\/@[^/]+\/video\//iu.test(snapshot.videoUrl ?? "") && snapshot.accountHandle),
        { now: latestSnapshotDate(videoSnapshots) ?? current }
      );
  const reportSignals = signals.length ? signals : derivedSignals;
  const allVideoSignals = signals
    .filter((signal) => signal.entityType === "video")
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const allDerivedVideoSignals = derivedSignals
    .filter((signal) => signal.entityType === "video")
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const rankedVideoSignals = allVideoSignals.length ? allVideoSignals : allDerivedVideoSignals;
  const recentSignals = reportSignals
    .filter((signal) => signal.detectedAt)
    .filter((signal) => hoursBetween(new Date(signal.detectedAt), current) <= recentWindowHours)
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const recentTopSignals = recentSignals
    .filter((signal) => signal.entityType === "video")
    .slice(0, maxSignals);
  const historicalTopSignals = recentTopSignals.length
    ? []
    : rankedVideoSignals.slice(0, maxSignals);
  const topSignals = recentTopSignals.length ? recentTopSignals : historicalTopSignals;
  const topRecentPublishedVideos = rankRecentPublishedVideos({
    videoSnapshots,
    now: current,
    maxVideos: maxSignals
  });
  const latestCollectionAt = videoSnapshots
    .map((snapshot) => snapshot.collectedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const summary = {
    trackedAccounts: accounts.filter((account) => account.enabled !== false).length,
    candidateAccounts: accountCandidates.length,
    trackedShops: shops.filter((shop) => shop.enabled !== false).length,
    totalSignals: reportSignals.length,
    recentSignals: recentSignals.length,
    latestCollectionAt,
    trackedVideos: new Set(videoSnapshots.map((snapshot) => snapshot.videoUrl).filter(Boolean)).size,
    usingHistoricalFallback: recentTopSignals.length === 0 && historicalTopSignals.length > 0,
    topSignals: topSignals.map((signal) => ({
      accountHandle: signal.accountHandle ?? "",
      entityUrl: signal.entityUrl,
      score: Number(signal.score ?? 0),
      windowHours: Number(signal.windowHours ?? 0),
      detectedAt: signal.detectedAt,
      deltas: signal.deltas ?? {},
      recommendedAction: signal.recommendedAction ?? "review"
    })),
    topRecentPublishedVideos: topRecentPublishedVideos.map((video) => ({
      accountHandle: video.accountHandle ?? "",
      entityUrl: video.videoUrl,
      publishedAt: video.publishedAt,
      metrics: {
        views: Number(video.views ?? 0),
        likes: Number(video.likes ?? 0),
        comments: Number(video.comments ?? 0),
        shares: Number(video.shares ?? 0)
      }
    })),
    baseUrl: resolvedBaseUrl
  };

  return {
    summary,
    text: renderMonitorReportText({ summary, generatedAt: current.toISOString(), recentWindowHours })
  };
}

export async function sendMonitorReport({
  dataDir = "monitoring_data",
  now = new Date(),
  recentWindowHours = 24,
  maxSignals = 5,
  baseUrl,
  notifier,
  alertMode = "dm",
  alertRecipient
} = {}) {
  const report = await buildMonitorReport({
    dataDir,
    now,
    recentWindowHours,
    maxSignals,
    baseUrl
  });
  const result = await notifier.send({
    channel: alertMode === "chat" ? "feishu-chat" : "feishu-dm",
    recipient: alertRecipient,
    text: report.text
  });
  await appendJsonLines(path.join(dataDir, "reports", "reports.jsonl"), [
    {
      sentAt: new Date(now).toISOString(),
      channel: alertMode === "chat" ? "feishu-chat" : "feishu-dm",
      recipient: alertRecipient,
      status: result?.status ?? "sent",
      messageId: result?.messageId,
      summary: report.summary
    }
  ]);

  return {
    sent: result?.status === "sent" ? 1 : 0,
    failed: result?.status === "sent" ? 0 : 1,
    summary: report.summary,
    text: report.text,
    messageId: result?.messageId
  };
}

function renderMonitorReportText({ summary, generatedAt, recentWindowHours }) {
  const lines = [
    "TikTok运营监控简报",
    `时间：${formatShanghaiDate(generatedAt)}`,
    `监控池：正式账号 ${summary.trackedAccounts} | 候选账号 ${summary.candidateAccounts} | 商品入口 ${summary.trackedShops}`,
    `数据覆盖：已采集 ${summary.trackedVideos} 条视频`
  ];

  if (summary.latestCollectionAt) {
    lines.push(`最近更新：${formatShanghaiDate(summary.latestCollectionAt)}`);
  }
  if (summary.baseUrl) {
    lines.push(`看板：${summary.baseUrl}`);
  }
  lines.push("今日结论：");
  if (!summary.topSignals.length) {
    lines.push(`- 近${recentWindowHours}小时暂未发现新的突增内容。`);
    lines.push("- 当前还在补足对比基线，建议继续观察已入池视频的下一轮表现。");
  } else {
    if (summary.usingHistoricalFallback) {
      lines.push(`- 近${recentWindowHours}小时暂未发现新的突增内容。`);
      lines.push("- 下方是最近一次值得参考的突增内容，可用于复盘选题。");
    } else {
      lines.push(`- 近${recentWindowHours}小时发现 ${summary.topSignals.length} 条值得跟进的突增内容。`);
    }
    lines.push(summary.usingHistoricalFallback ? "最近一次值得参考的突增内容：" : "重点跟进内容：");
    for (const [index, signal] of summary.topSignals.entries()) {
      lines.push(
        `${index + 1}. ${signal.accountHandle || "unknown"} | ${signal.windowHours}h内 播放+${Number(signal.deltas.views ?? 0)} | 点赞+${Number(signal.deltas.likes ?? 0)} | 评论+${Number(signal.deltas.comments ?? 0)} | 分享+${Number(signal.deltas.shares ?? 0)}`
      );
      if (signal.detectedAt) {
        lines.push(`   发现时间：${formatShanghaiDate(signal.detectedAt)}`);
      }
      lines.push(`   链接：${signal.entityUrl}`);
      lines.push(`   建议动作：${renderSignalAction(signal)}`);
    }
  }

  if (!summary.topRecentPublishedVideos.length) {
    lines.push("近7天暂无值得关注的新发视频。");
    return lines.join("\n");
  }

  lines.push("近7天值得关注的新发视频：");
  for (const [index, video] of summary.topRecentPublishedVideos.entries()) {
    lines.push(
      `${index + 1}. ${video.accountHandle || "unknown"} | 发布 ${formatShanghaiDate(video.publishedAt)} | 当前播放 ${Number(video.metrics.views ?? 0)} | 点赞 ${Number(video.metrics.likes ?? 0)} | 评论 ${Number(video.metrics.comments ?? 0)} | 分享 ${Number(video.metrics.shares ?? 0)}`
    );
    lines.push(`   链接：${video.entityUrl}`);
    lines.push(`   建议动作：${renderRecentVideoAction(video)}`);
  }
  return lines.join("\n");
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function formatShanghaiDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

async function loadHistoricalJsonLines({ dataDir, filePath }) {
  const dirs = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (["seeds", "signals", "snapshots", "alerts", "reports", "leads"].includes(dir.name)) continue;
    if (/smoke/iu.test(dir.name)) continue;
    items.push(...await readJsonLines(path.join(dataDir, dir.name, ...filePath)));
  }
  return items;
}

function latestSnapshotDate(videoSnapshots) {
  const latest = videoSnapshots
    .map((snapshot) => snapshot.collectedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return latest ? new Date(latest) : undefined;
}

function rankRecentPublishedVideos({ videoSnapshots = [], now = new Date(), maxVideos = 5 }) {
  const latestByUrl = new Map();
  for (const snapshot of videoSnapshots) {
    if (!snapshot?.videoUrl) continue;
    const current = latestByUrl.get(snapshot.videoUrl);
    if (!current || String(snapshot.collectedAt ?? "") >= String(current.collectedAt ?? "")) {
      latestByUrl.set(snapshot.videoUrl, snapshot);
    }
  }

  return [...latestByUrl.values()]
    .map((snapshot) => ({
      accountHandle: snapshot.accountHandle ?? "",
      videoUrl: snapshot.videoUrl,
      publishedAt: resolveVideoPublishedAt(snapshot),
      views: Number(snapshot.views ?? 0),
      likes: Number(snapshot.likes ?? 0),
      comments: Number(snapshot.comments ?? 0),
      shares: Number(snapshot.shares ?? 0)
    }))
    .filter((video) => video.publishedAt)
    .filter((video) => hoursBetween(new Date(video.publishedAt), now) <= 24 * 7)
    .sort((left, right) => {
      const viewDiff = Number(right.views ?? 0) - Number(left.views ?? 0);
      if (viewDiff !== 0) return viewDiff;
      const likeDiff = Number(right.likes ?? 0) - Number(left.likes ?? 0);
      if (likeDiff !== 0) return likeDiff;
      const shareDiff = Number(right.shares ?? 0) - Number(left.shares ?? 0);
      if (shareDiff !== 0) return shareDiff;
      const commentDiff = Number(right.comments ?? 0) - Number(left.comments ?? 0);
      if (commentDiff !== 0) return commentDiff;
      return new Date(right.publishedAt) - new Date(left.publishedAt);
    })
    .slice(0, maxVideos);
}

function resolveVideoPublishedAt(snapshot) {
  if (snapshot?.postedAt) {
    const postedAt = new Date(snapshot.postedAt);
    if (!Number.isNaN(postedAt.getTime())) return postedAt.toISOString();
  }
  const match = String(snapshot?.videoUrl ?? "").match(/\/video\/(\d+)/iu);
  if (!match) return undefined;
  try {
    const unixSeconds = Number(BigInt(match[1]) >> 32n);
    const derived = new Date(unixSeconds * 1000);
    if (Number.isNaN(derived.getTime())) return undefined;
    if (derived.getUTCFullYear() < 2018 || derived.getUTCFullYear() > 2100) return undefined;
    return derived.toISOString();
  } catch {
    return undefined;
  }
}

function renderSignalAction(signal) {
  if (Number(signal.deltas.shares ?? 0) >= 1000 || Number(signal.deltas.likes ?? 0) >= 5000) {
    return "优先加入拆解池，复盘开头钩子、叙事结构和评论区反馈。";
  }
  if (Number(signal.deltas.comments ?? 0) >= 100) {
    return "优先查看评论区需求点，判断是否适合跟进同主题内容。";
  }
  return "保持观察，下一轮继续确认增长是否延续。";
}

function renderRecentVideoAction(video) {
  if (Number(video.metrics.shares ?? 0) >= 1000) {
    return "优先复盘转发动机和选题角度，可进入下一批内容模仿池。";
  }
  if (Number(video.metrics.likes ?? 0) >= 1000) {
    return "优先复盘封面、开头和脚本文案，评估是否值得快速跟拍。";
  }
  return "加入观察名单，等下一轮数据后再判断是否升级跟进。";
}
