import { readdir } from "node:fs/promises";
import path from "node:path";

import { analyzeVideoSnapshots } from "./analyzer.mjs";
import { mergeCompetitorAccounts } from "./account-pool.mjs";
import { buildBaseDashboardRecords } from "./base-dashboard.mjs";
import { appendJsonLines, ensureMonitorDataDirs, readJsonFile, readJsonLines } from "./storage.mjs";
import { buildRecentStrongVideoMap, countRecentStrongVideosByAccount, rankRecentStrongVideos } from "./operator-ranking.mjs";
import { isCanonicalTikTokVideoUrl, resolveTikTokVideoPostedAt } from "./video-time.mjs";
import { canonicalizeThemeLabel, inferThemeFromCaption } from "./theme-labels.mjs";
import { isWhitelistSourceConfigured, loadWhitelistAccounts } from "./whitelist-accounts.mjs";

const RECENT_VIDEO_RETENTION_DAYS = 90;

export async function buildMonitorReport({
  dataDir = "monitoring_data",
  now = new Date(),
  recentWindowHours = 24,
  maxSignals = 3,
  baseUrl,
  dashboardRecords,
  whitelistAccounts,
  baseDashboardConfigPath
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const resolvedWhitelistAccounts = whitelistAccounts ?? await loadWhitelistAccounts({ dataDir, baseDashboardConfigPath });
  const whitelistConfigured = Array.isArray(whitelistAccounts)
    ? true
    : await isWhitelistSourceConfigured({ dataDir, baseDashboardConfigPath });
  const accounts = resolvedWhitelistAccounts.length
    ? resolvedWhitelistAccounts
    : await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const accountCandidates = whitelistConfigured
    ? []
    : await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []);
  const rootSignals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const rootVideoSnapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const historicalSignals = rootSignals.length ? [] : await loadHistoricalJsonLines({ dataDir, filePath: ["signals", "signals.jsonl"] });
  const historicalVideoSnapshots = rootVideoSnapshots.length ? [] : await loadHistoricalJsonLines({ dataDir, filePath: ["snapshots", "video_snapshots.jsonl"] });
  const dashboardConfig = await readJsonFile(path.join(dataDir, "base_dashboard_config.json"), {});
  const resolvedDashboardRecords = dashboardRecords ?? await buildBaseDashboardRecords({ dataDir, baseDashboardConfigPath });
  const current = new Date(now);
  const resolvedBaseUrl = baseUrl ?? dashboardConfig?.url;
  const allVideoSnapshots = rootVideoSnapshots.length ? rootVideoSnapshots : historicalVideoSnapshots;
  const competitorAccounts = whitelistConfigured
    ? resolvedWhitelistAccounts.filter((account) => account.skipTracking !== true && account.enabled !== false)
    : mergeCompetitorAccounts({ accounts, accountCandidates });
  const trackedHandleSet = new Set(competitorAccounts.map((account) => String(account.handle ?? "").trim()).filter(Boolean));
  const initialVideoSnapshots = filterSnapshotsWithinDays(allVideoSnapshots, current, RECENT_VIDEO_RETENTION_DAYS)
    .filter((snapshot) => isCanonicalTikTokVideoUrl(snapshot?.videoUrl ?? ""));
  const videoSnapshots = resolvedWhitelistAccounts.length
    ? initialVideoSnapshots.filter((snapshot) => trackedHandleSet.has(String(snapshot.accountHandle ?? "").trim()))
    : initialVideoSnapshots;
  const initialSignals = rootSignals.length ? rootSignals : historicalSignals;
  const signals = resolvedWhitelistAccounts.length
    ? initialSignals.filter((signal) => !signal.accountHandle || trackedHandleSet.has(String(signal.accountHandle ?? "").trim()))
    : initialSignals;
  const derivedSignals = signals.length
    ? []
    : analyzeVideoSnapshots(
        videoSnapshots.filter((snapshot) => /tiktok\.com\/@[^/]+\/video\//iu.test(snapshot.videoUrl ?? "") && snapshot.accountHandle),
        { now: latestSnapshotDate(videoSnapshots) ?? current }
      );
  const reportSignals = signals.length ? signals : derivedSignals;
  const dedupedVideoSignals = dedupeVideoSignals(
    reportSignals.filter((signal) => signal.entityType === "video")
  );
  const allVideoSignals = dedupedVideoSignals
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const allDerivedVideoSignals = derivedSignals
    .filter((signal) => signal.entityType === "video")
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const rankedVideoSignals = allVideoSignals.length ? allVideoSignals : allDerivedVideoSignals;
  const recentSignals = dedupeSignals(
    reportSignals
    .filter((signal) => signal.detectedAt)
    .filter((signal) => hoursBetween(new Date(signal.detectedAt), current) <= recentWindowHours)
  ).sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const recentVideoSignals = recentSignals.filter((signal) => signal.entityType === "video");
  const recentTopSignals = rankSignalsForOperators(
    recentVideoSignals.filter((signal) => isMustWatchSignalKind(resolveSignalKind(signal)))
  ).slice(0, maxSignals);
  const historicalTopSignals = recentTopSignals.length
    ? []
    : rankSignalsForOperators(
        rankedVideoSignals.filter((signal) => isMustWatchSignalKind(resolveSignalKind(signal)))
      ).slice(0, maxSignals);
  const topSignals = recentTopSignals.length ? recentTopSignals : historicalTopSignals;
  const topRecentStrongVideos = rankRecentStrongVideos({
    videoSnapshots,
    now: current,
    maxVideos: maxSignals
  });
  const recentStrongCount = buildRecentStrongVideoMap({ videoSnapshots, now: current }).size;
  const topMustWatchVideos = mergeOperatorVideos({
    signalVideos: topSignals,
    strongVideos: topRecentStrongVideos,
    maxVideos: maxSignals
  });
  const accountMap = new Map(competitorAccounts.map((account) => [account.handle, account]));
  const latestSnapshotsByUrl = new Map(
    dedupeLatestSnapshots(videoSnapshots)
      .filter((snapshot) => snapshot?.videoUrl)
      .map((snapshot) => [snapshot.videoUrl, snapshot])
  );
  const dashboardThemeReferences = rankDashboardThemeReferences({
    themeRecords: resolvedDashboardRecords?.themes ?? [],
    latestSnapshotsByUrl,
    maxThemes: maxSignals
  });
  const topThemeReferences = dashboardThemeReferences.length ? dashboardThemeReferences : rankThemeReferences({
    videoSnapshots,
    strongVideos: topRecentStrongVideos,
    accountMap,
    now: current,
    maxThemes: maxSignals
  });
  const watchAccounts = rankWatchAccounts({
    accounts: competitorAccounts,
    videoSnapshots,
    signals: reportSignals,
    now: current,
    maxAccounts: 3
  });
  const signalBuckets = countSignalBuckets(reportSignals);
  const latestCollectionAt = videoSnapshots
    .map((snapshot) => snapshot.collectedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const summary = {
    trackedAccounts: competitorAccounts.length,
    totalSignals: reportSignals.length,
    recentSignals: recentSignals.length,
    signalBuckets,
    latestCollectionAt,
    trackedVideos: new Set(videoSnapshots.map((snapshot) => snapshot.videoUrl).filter(Boolean)).size,
    usingHistoricalFallback: recentTopSignals.length === 0 && historicalTopSignals.length > 0,
    recentStrongCount,
    topMustWatchVideos,
    topSignals: topSignals.map((signal) => ({
      accountHandle: signal.accountHandle ?? "",
      entityUrl: signal.entityUrl,
      score: Number(signal.score ?? 0),
      windowHours: Number(signal.windowHours ?? 0),
      ageBucket: signal.ageBucket ?? "",
      signalKind: resolveSignalKind(signal),
      signalLabel: signal.signalLabel ?? inferSignalLabel(signal),
      detectedAt: signal.detectedAt,
      publishedAt: resolveVideoPublishedAt(signal.current),
      deltas: signal.deltas ?? {},
      currentMetrics: resolveSignalMetrics(signal),
      benchmark: signal.benchmark ?? {},
      recommendedAction: signal.recommendedAction ?? "review",
      operatorAction: signal.operatorAction ?? ""
    })),
    topRecentStrongVideos: topRecentStrongVideos.map((video) => ({
      accountHandle: video.accountHandle ?? "",
      entityUrl: video.videoUrl,
      publishedAt: video.publishedAt,
      metrics: {
        views: Number(video.views ?? 0),
        likes: Number(video.likes ?? 0),
        comments: Number(video.comments ?? 0),
        shares: Number(video.shares ?? 0)
      },
      rates: {
        engagement: safeRatio(
          Number(video.likes ?? 0) + Number(video.comments ?? 0) + Number(video.shares ?? 0),
          Number(video.views ?? 0)
        ),
        share: safeRatio(Number(video.shares ?? 0), Number(video.views ?? 0)),
        comment: safeRatio(Number(video.comments ?? 0), Number(video.views ?? 0))
      },
      reasons: video.reasons ?? [],
      label: video.label ?? "近7天好素材",
      priority: Number(video.priority ?? 3),
      operatorAction: video.operatorAction ?? ""
    })),
    topThemeReferences,
    watchAccounts,
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
  maxSignals = 3,
  baseUrl,
  notifier,
  alertMode = "dm",
  alertRecipient,
  baseDashboardConfigPath
} = {}) {
  const report = await buildMonitorReport({
    dataDir,
    now,
    recentWindowHours,
    maxSignals,
    baseUrl
    ,
    baseDashboardConfigPath
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
  const mustWatchTop = summary.topMustWatchVideos.slice(0, 3);
  const recentStrongTop = summary.topRecentStrongVideos.slice(0, 3);
  const themeTop = summary.topThemeReferences.slice(0, 3);
  const watchAccountsTop = summary.watchAccounts.slice(0, 3);
  const lines = [
    "TikTok同行晨会简报",
    `时间：${formatShanghaiDate(generatedAt)}`
  ];

  if (summary.latestCollectionAt) {
    lines.push(`最近更新：${formatShanghaiDate(summary.latestCollectionAt)}`);
  }
  if (summary.baseUrl) {
    lines.push(`看板：${summary.baseUrl}`);
  }
  lines.push(
    `今天顺序：先看新爆｜再翻主题｜再抄近期｜最后盯账号`
  );
  if (mustWatchTop[0]) {
    lines.push(`头号爆点：${mustWatchTop[0].accountHandle || "unknown"}｜${mustWatchTop[0].label || "重点内容"}｜24h +${formatNumber(mustWatchTop[0].deltas?.views ?? 0)}`);
  }
  if (themeTop[0]) {
    lines.push(`主题先翻：${themeTop[0].theme}｜${themeTop[0].roleLabel || "起量抄法"}｜高表现 ${formatNumber(themeTop[0].qualifiedCount ?? 0)}`);
  }
  if (recentStrongTop[0]) {
    lines.push(`近期可抄：${recentStrongTop[0].accountHandle || "unknown"}｜点赞 ${formatNumber(recentStrongTop[0].metrics.likes)}｜分享率 ${formatPercent(recentStrongTop[0].rates.share)}`);
  }
  if (watchAccountsTop[0]) {
    lines.push(`今天先盯：${watchAccountsTop[0].accountHandle}｜近7天好素材 ${watchAccountsTop[0].strongCount7d} 条｜主打 ${watchAccountsTop[0].hotTheme || "待补主题"}`);
  }
  lines.push("头号爆点主战区 TOP3：");
  if (!mustWatchTop.length) {
    lines.push(`- 近${recentWindowHours}小时没有新的重点起量内容。`);
    lines.push("- 先翻主题，再补看近7天可抄素材。");
  } else {
    for (const [index, item] of mustWatchTop.entries()) {
      lines.push(
        `${index + 1}. ${item.accountHandle || "unknown"}｜${item.label || "重点内容"}｜${Number(item.deltas?.views ?? 0) > 0 ? `24h播放 +${formatNumber(item.deltas.views)}` : `当前播放 ${formatNumber(item.metrics.views)}`}`
      );
      const deltaSummary = Number(item.deltas?.views ?? 0) > 0
        ? `24h播放 +${formatNumber(item.deltas.views)}`
        : `当前播放 ${formatNumber(item.metrics.views)}`;
      const shareSummary = Number(item.metrics?.shares ?? 0) > 0
        ? `分享 ${formatNumber(item.metrics.shares)}`
        : `点赞 ${formatNumber(item.metrics.likes)}`;
      const reasonSummary = Number(item.benchmark?.viewMultiple ?? 0) > 0
        ? `高于常规 ${formatMultiple(item.benchmark.viewMultiple)}`
        : item.reasons?.join(" / ") || "已进入重点预警";
      lines.push(`   ${shareSummary}｜${reasonSummary}｜发布 ${formatShanghaiDate(item.publishedAt)}`);
      lines.push(`   先做：${compactReportAction(item.operatorAction || renderSignalAction(item), "先看这条起量原因")}｜${item.entityUrl}`);
    }
  }

  lines.push("主题先翻 TOP3：");
  if (!themeTop.length) {
    lines.push("- 暂无可归纳的商品主题参考。");
  } else {
    for (const [index, theme] of themeTop.entries()) {
      lines.push(
        `${index + 1}. ${theme.theme}｜${theme.roleLabel || "起量抄法"}｜高表现 ${formatNumber(theme.qualifiedCount ?? 0)}｜近7天上新 ${formatNumber(theme.recent7dCount ?? 0)}`
      );
      lines.push(
        `   代表 ${theme.accountHandle || "待补账号"}｜发布 ${formatShanghaiDate(theme.publishedAt)}｜播放 ${formatNumber(theme.topViews)}｜分享 ${formatNumber(theme.topShares)}`
      );
      lines.push(`   先做：${compactReportAction(theme.operatorAction, theme.roleHint || "先顺着这个主题往下翻")}｜${theme.entityUrl}`);
    }
  }

  if (!recentStrongTop.length) {
    lines.push("近7天可直接抄 TOP3：");
    lines.push("- 暂无近7天已经明显跑出结果的新发素材。");
  } else {
    lines.push("近7天可直接抄 TOP3：");
    for (const [index, video] of recentStrongTop.entries()) {
      lines.push(
        `${index + 1}. ${video.accountHandle || "unknown"}｜点赞 ${formatNumber(video.metrics.likes)}｜分享率 ${formatPercent(video.rates.share)}`
      );
      lines.push(`   分享 ${formatNumber(video.metrics.shares)}｜播放 ${formatNumber(video.metrics.views)}｜发布 ${formatShanghaiDate(video.publishedAt)}`);
      lines.push(`   先做：${compactReportAction(video.operatorAction || renderRecentVideoAction(video), "先拆标题、开场和转发点")}｜${video.entityUrl}`);
    }
  }

  lines.push("今天先盯账号 TOP3：");
  if (!watchAccountsTop.length) {
    lines.push("- 今天没有新的重点账号变化。");
  } else {
    for (const [index, account] of watchAccountsTop.entries()) {
      lines.push(
        `${index + 1}. ${account.accountHandle}｜${account.hotTheme || "待补主题"}｜近7天好素材 ${account.strongCount7d} 条`
      );
      const latestVideoLine = account.latestHotVideoUrl ? `｜链接：${account.latestHotVideoUrl}` : "";
      lines.push(`   现在盯：近7天发 ${account.posts7d} 条｜近15天最佳 ${formatNumber(account.topViews15d)}${latestVideoLine}`);
    }
  }
  lines.push(`监控池：账号池 ${summary.trackedAccounts} | 近90天视频 ${summary.trackedVideos}`);
  return lines.join("\n");
}

function compactReportAction(text, fallback = "先翻这条看看") {
  const source = String(text || fallback || "").trim();
  if (!source) return "先翻这条看看";
  const cleaned = source
    .replace(/^先做[:：]\s*/u, "")
    .replace(/^动作[:：]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const firstChunk = cleaned.split(/[。！？!?\n]/u).find(Boolean)?.trim() || cleaned;
  const shortChunk = firstChunk.split(/[；;｜|]/u).find(Boolean)?.trim() || firstChunk;
  return shortChunk.length > 24 ? `${shortChunk.slice(0, 24).trim()}…` : shortChunk;
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function formatShanghaiDate(value) {
  if (!value) return "未知";
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

function rankSignalsForOperators(signals = []) {
  return [...signals].sort((left, right) => {
    const priorityDiff = Number(left.signalPriority ?? inferSignalPriority(left)) - Number(right.signalPriority ?? inferSignalPriority(right));
    if (priorityDiff !== 0) return priorityDiff;
    const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const shareDiff = Number(right.deltas?.shares ?? 0) - Number(left.deltas?.shares ?? 0);
    if (shareDiff !== 0) return shareDiff;
    return String(right.detectedAt ?? "").localeCompare(String(left.detectedAt ?? ""));
  });
}

function countSignalBuckets(signals = []) {
  const videoSignals = dedupeVideoSignals(signals.filter((signal) => signal.entityType === "video"));
  const recent3d = videoSignals.filter((signal) => resolveSignalKind(signal) === "new_breakout").length;
  const recent7d = videoSignals.filter((signal) => resolveSignalKind(signal) === "sustained_growth").length;
  const recent15d = videoSignals.filter((signal) => resolveSignalKind(signal) === "long_tail_winner").length;
  return { recent3d, recent7d, recent15d };
}

function isMustWatchSignalKind(signalKind) {
  return signalKind === "new_breakout" || signalKind === "sustained_growth";
}

function rankWatchAccounts({ accounts = [], videoSnapshots = [], signals = [], now = new Date(), maxAccounts = 3 }) {
  const byAccount = new Map();
  const strongCountByAccount = countRecentStrongVideosByAccount({ videoSnapshots, now });
  const latestStrongByAccount = latestStrongVideoByAccount({ videoSnapshots, now });
  for (const snapshot of videoSnapshots) {
    if (!snapshot?.accountHandle || !snapshot?.videoUrl) continue;
    if (!byAccount.has(snapshot.accountHandle)) byAccount.set(snapshot.accountHandle, []);
    byAccount.get(snapshot.accountHandle).push(snapshot);
  }
  const latestSignalByAccount = new Map();
  for (const signal of signals.filter((item) => item.entityType === "video" && item.accountHandle)) {
    const current = latestSignalByAccount.get(signal.accountHandle);
    if (!current || String(signal.detectedAt ?? "") > String(current.detectedAt ?? "")) {
      latestSignalByAccount.set(signal.accountHandle, signal);
    }
  }

  return accounts
    .map((account) => {
      const snapshots = dedupeLatestSnapshots(byAccount.get(account.handle) ?? []);
      const recent7d = snapshots.filter((item) => ageHours(item, now) <= 24 * 7);
      const recent15d = snapshots.filter((item) => ageHours(item, now) <= 24 * 15);
      const signal = latestSignalByAccount.get(account.handle);
      const strongCount7d = Number(strongCountByAccount.get(account.handle) ?? 0);
      return {
        accountHandle: account.handle,
        profileUrl: account.profileUrl,
        watchLevel: classifyAccountPriority({ signal, strongCount7d, posts7d: recent7d.length }),
        posts7d: recent7d.length,
        avgViews15d: average(recent15d.map((item) => Number(item.views ?? 0))),
        topViews15d: Math.max(0, ...recent15d.map((item) => Number(item.views ?? 0))),
        strongCount7d,
        hotTheme:
          dominantThemeForSnapshots(recent7d) ||
          canonicalizeThemeLabel(String((Array.isArray(account.sourceQueries) ? account.sourceQueries[0] : account.sourceQuery) ?? "").trim()) ||
          "待补主题",
        latestHotVideoUrl:
          signal?.entityUrl ??
          latestStrongByAccount.get(account.handle)?.videoUrl ??
          [...(recent15d.length ? recent15d : snapshots)]
            .sort((left, right) => {
              if (Number(right.views ?? 0) !== Number(left.views ?? 0)) return Number(right.views ?? 0) - Number(left.views ?? 0);
              return String(resolveVideoPublishedAt(right) ?? "").localeCompare(String(resolveVideoPublishedAt(left) ?? ""));
            })[0]?.videoUrl ??
          "",
        lastSignalAt: signal?.detectedAt ?? latestStrongByAccount.get(account.handle)?.publishedAt ?? ""
      };
    })
    .filter((account) => account.strongCount7d > 0 || Boolean(account.lastSignalAt))
    .sort((left, right) => {
      const leftPriority = watchLevelPriority(left.watchLevel);
      const rightPriority = watchLevelPriority(right.watchLevel);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (right.strongCount7d !== left.strongCount7d) return right.strongCount7d - left.strongCount7d;
      if (right.posts7d !== left.posts7d) return right.posts7d - left.posts7d;
      if (right.topViews15d !== left.topViews15d) return right.topViews15d - left.topViews15d;
      return String(right.lastSignalAt).localeCompare(String(left.lastSignalAt));
    })
    .slice(0, maxAccounts);
}

function resolveVideoPublishedAt(snapshot) {
  return resolveTikTokVideoPostedAt(snapshot) || undefined;
}

function dominantThemeForSnapshots(snapshots = []) {
  const byTheme = new Map();
  for (const snapshot of snapshots) {
    const theme = deriveThemeLabel(snapshot);
    if (!theme) continue;
    const current = byTheme.get(theme) ?? { theme, count: 0, topViews: 0, latestPublishedAt: "" };
    current.count += 1;
    current.topViews = Math.max(current.topViews, Number(snapshot.views ?? 0));
    current.latestPublishedAt = [current.latestPublishedAt, resolveVideoPublishedAt(snapshot)].filter(Boolean).sort().at(-1) ?? current.latestPublishedAt;
    byTheme.set(theme, current);
  }
  return [...byTheme.values()]
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.topViews !== left.topViews) return right.topViews - left.topViews;
      return String(right.latestPublishedAt).localeCompare(String(left.latestPublishedAt));
    })[0]?.theme ?? "";
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
  if (Number(video.metrics.shares ?? 0) >= 100 || Number(video.rates?.share ?? 0) >= 0.01) {
    return "优先复盘转发动机和选题角度，可进入下一批内容模仿池。";
  }
  if (Number(video.rates?.engagement ?? 0) >= 0.08 || Number(video.metrics.likes ?? 0) >= 1000) {
    return "优先复盘封面、开头和脚本文案，评估是否值得快速跟拍。";
  }
  return "加入观察名单，等下一轮数据后再判断是否升级跟进。";
}

function mergeOperatorVideos({ signalVideos = [], strongVideos = [], maxVideos = 5 }) {
  const byUrl = new Map();
  for (const signal of signalVideos) {
    byUrl.set(signal.entityUrl, {
      accountHandle: signal.accountHandle ?? "",
      entityUrl: signal.entityUrl,
      publishedAt: signal.publishedAt ?? resolveVideoPublishedAt(signal.current) ?? resolveTikTokVideoPostedAt(signal),
      label: signal.signalLabel ?? inferSignalLabel(signal),
      priority: Number(signal.signalPriority ?? inferSignalPriority(signal)),
      deltas: signal.deltas ?? {},
      metrics: resolveSignalMetrics(signal),
      benchmark: signal.benchmark ?? {},
      operatorAction: signal.operatorAction ?? signal.recommendedAction ?? "",
      reasons: []
    });
  }
  for (const strongVideo of strongVideos) {
    const current = byUrl.get(strongVideo.videoUrl);
    const candidate = {
      accountHandle: strongVideo.accountHandle ?? "",
      entityUrl: strongVideo.videoUrl,
      publishedAt: strongVideo.publishedAt,
      label: strongVideo.label ?? "近7天好素材",
      priority: Number(strongVideo.priority ?? 3),
      deltas: { views: 0, likes: 0, comments: 0, shares: 0 },
      metrics: {
        views: Number(strongVideo.views ?? 0),
        likes: Number(strongVideo.likes ?? 0),
        comments: Number(strongVideo.comments ?? 0),
        shares: Number(strongVideo.shares ?? 0)
      },
      benchmark: {},
      operatorAction: strongVideo.operatorAction ?? "",
      reasons: strongVideo.reasons ?? []
    };
    if (!current || candidate.priority < current.priority) {
      byUrl.set(strongVideo.videoUrl, candidate);
    }
  }
  return [...byUrl.values()]
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (Number(right.deltas?.views ?? 0) !== Number(left.deltas?.views ?? 0)) {
        return Number(right.deltas?.views ?? 0) - Number(left.deltas?.views ?? 0);
      }
      if (Number(right.metrics?.shares ?? 0) !== Number(left.metrics?.shares ?? 0)) {
        return Number(right.metrics?.shares ?? 0) - Number(left.metrics?.shares ?? 0);
      }
      if (Number(right.metrics?.likes ?? 0) !== Number(left.metrics?.likes ?? 0)) {
        return Number(right.metrics?.likes ?? 0) - Number(left.metrics?.likes ?? 0);
      }
      return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
    })
    .slice(0, maxVideos);
}

function dedupeSignals(signals = []) {
  const byKey = new Map();
  for (const signal of signals) {
    const entityUrl = signal?.entityUrl ?? "";
    const kind = resolveSignalKind(signal);
    const key = `${entityUrl}::${kind}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, signal);
      continue;
    }
    const currentDetectedAt = String(current.detectedAt ?? current.collectedAt ?? "");
    const nextDetectedAt = String(signal.detectedAt ?? signal.collectedAt ?? "");
    if (nextDetectedAt > currentDetectedAt) {
      byKey.set(key, signal);
      continue;
    }
    if (nextDetectedAt === currentDetectedAt && Number(signal.score ?? 0) > Number(current.score ?? 0)) {
      byKey.set(key, signal);
    }
  }
  return [...byKey.values()];
}

function dedupeVideoSignals(signals = []) {
  const byUrl = new Map();
  for (const signal of dedupeSignals(signals)) {
    const entityUrl = signal?.entityUrl ?? "";
    if (!entityUrl) continue;
    const current = byUrl.get(entityUrl);
    if (!current) {
      byUrl.set(entityUrl, signal);
      continue;
    }
    const currentPriority = Number(current.signalPriority ?? inferSignalPriority(current));
    const nextPriority = Number(signal.signalPriority ?? inferSignalPriority(signal));
    if (nextPriority < currentPriority) {
      byUrl.set(entityUrl, signal);
      continue;
    }
    if (nextPriority === currentPriority) {
      const currentScore = Number(current.score ?? 0);
      const nextScore = Number(signal.score ?? 0);
      if (nextScore > currentScore) {
        byUrl.set(entityUrl, signal);
        continue;
      }
      if (nextScore === currentScore) {
        const currentDetectedAt = String(current.detectedAt ?? current.collectedAt ?? "");
        const nextDetectedAt = String(signal.detectedAt ?? signal.collectedAt ?? "");
        if (nextDetectedAt > currentDetectedAt) {
          byUrl.set(entityUrl, signal);
        }
      }
    }
  }
  return [...byUrl.values()];
}

function rankThemeReferences({ videoSnapshots = [], strongVideos = [], accountMap = new Map(), now = new Date(), maxThemes = 5 }) {
  const latestByUrl = dedupeLatestSnapshots(videoSnapshots);
  const grouped = new Map();
  const strongUrlSet = new Set(strongVideos.map((item) => item.videoUrl));
  for (const snapshot of latestByUrl.values()) {
    const publishedAt = resolveVideoPublishedAt(snapshot);
    if (!publishedAt) continue;
    if (hoursBetween(new Date(publishedAt), now) > 24 * 90) continue;
    const theme = deriveThemeLabel(snapshot, accountMap.get(snapshot.accountHandle ?? ""));
    if (!theme) continue;
    const views = Number(snapshot.views ?? 0);
    const likes = Number(snapshot.likes ?? 0);
    const shares = Number(snapshot.shares ?? 0);
    const comments = Number(snapshot.comments ?? 0);
    const isStrong = strongUrlSet.has(snapshot.videoUrl);
    const qualifies = isStrong || likes >= 1000 || shares >= 100 || comments >= 50 || views >= 10000;
    if (!qualifies) continue;
    if (!grouped.has(theme)) grouped.set(theme, []);
    grouped.get(theme).push({
      theme,
      accountHandle: snapshot.accountHandle ?? "",
      entityUrl: snapshot.videoUrl,
      publishedAt,
      views,
      likes,
      shares,
      comments,
      isStrong
    });
  }
  return [...grouped.entries()]
    .map(([theme, items]) => {
      const sorted = [...items].sort((left, right) => {
        if (Number(right.isStrong) !== Number(left.isStrong)) return Number(right.isStrong) - Number(left.isStrong);
        if (right.shares !== left.shares) return right.shares - left.shares;
        if (right.likes !== left.likes) return right.likes - left.likes;
        if (right.views !== left.views) return right.views - left.views;
        return String(right.publishedAt).localeCompare(String(left.publishedAt));
      });
      const top = sorted[0];
      return {
        theme,
        accountHandle: top.accountHandle,
        videoCount: items.length,
        recent7dCount: items.filter((item) => hoursBetween(new Date(item.publishedAt), now) <= 24 * 7).length,
        qualifiedCount: items.length,
        entityUrl: top.entityUrl,
        publishedAt: top.publishedAt,
        topViews: top.views,
        topLikes: top.likes,
        topShares: top.shares,
        ...classifyThemeReferenceRole({
          top,
          recent7dCount: items.filter((item) => hoursBetween(new Date(item.publishedAt), now) <= 24 * 7).length
        })
      };
    })
    .sort((left, right) => {
      if (right.topShares !== left.topShares) return right.topShares - left.topShares;
      if (right.topLikes !== left.topLikes) return right.topLikes - left.topLikes;
      if (right.topViews !== left.topViews) return right.topViews - left.topViews;
      return right.videoCount - left.videoCount;
    })
    .slice(0, maxThemes);
}

function rankDashboardThemeReferences({ themeRecords = [], latestSnapshotsByUrl = new Map(), maxThemes = 5 }) {
  const mapped = themeRecords
    .map((record) => mapDashboardThemeReference(record, latestSnapshotsByUrl))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (right.qualifiedCount !== left.qualifiedCount) return right.qualifiedCount - left.qualifiedCount;
      if (right.recent7dCount !== left.recent7dCount) return right.recent7dCount - left.recent7dCount;
      return right.topViews - left.topViews;
    });
  return mapped.slice(0, maxThemes);
}

function mapDashboardThemeReference(record, latestSnapshotsByUrl) {
  const fields = record?.fields ?? {};
  const theme = String(fields["主题"] ?? record?.key ?? "").trim();
  if (!theme) return null;
  const representativeVideo = parseMarkdownLink(fields["代表视频链接"]);
  const representativeAccount = parseMarkdownLink(fields["代表账号"]);
  const snapshot = representativeVideo.url ? latestSnapshotsByUrl.get(representativeVideo.url) : undefined;
  const recent7dCount = Number(fields["近7天上新数"] ?? 0);
  const qualifiedCount = Number(fields["高表现视频数"] ?? 0);
  const topViews = Number(snapshot?.views ?? fields["最高播放"] ?? 0);
  const topLikes = Number(snapshot?.likes ?? fields["最高点赞"] ?? 0);
  const topShares = Number(snapshot?.shares ?? fields["最高分享"] ?? 0);
  const role = classifyDashboardThemeRole({ recent7dCount, qualifiedCount, topViews });
  return {
    theme,
    rank: Number(fields["主题排名"] ?? 9999),
    accountHandle: representativeAccount.label || String(snapshot?.accountHandle ?? "").trim(),
    videoCount: Number(fields["近3个月收录视频数"] ?? 0),
    recent7dCount,
    qualifiedCount,
    entityUrl: representativeVideo.url || "",
    publishedAt: resolveVideoPublishedAt(snapshot) || String(fields["代表视频发布时间"] ?? "").trim(),
    topViews,
    topLikes,
    topShares,
    roleLabel: role.roleLabel,
    roleHint: role.roleHint,
    operatorAction: String(fields["跟进建议"] ?? "").trim() || role.operatorAction
  };
}

function classifyDashboardThemeRole({ recent7dCount = 0, qualifiedCount = 0, topViews = 0 }) {
  if (qualifiedCount >= 80 || topViews >= 3000000) {
    return {
      roleLabel: "重点扩题",
      roleHint: "先拆代表视频，再顺着这个主题扩一批同类型选题",
      operatorAction: "先拆代表视频，再顺着这个主题扩一批同类型选题。"
    };
  }
  if (recent7dCount >= 5 || qualifiedCount >= 40) {
    return {
      roleLabel: "持续起量",
      roleHint: "优先看最近7天的新内容，找还在起量的结构",
      operatorAction: "优先看最近7天的新内容，找还在起量的结构，再回看同主题近3个月内容。"
    };
  }
  return {
    roleLabel: "稳定参考",
    roleHint: "回看近3个月稳定跑出来的题材和开场",
    operatorAction: "回看近3个月稳定跑出来的题材和开场，再筛能直接复用的素材。"
  };
}

function classifyThemeReferenceRole({ top, recent7dCount }) {
  if (Number(top.shares ?? 0) >= 300 || Number(top.likes ?? 0) >= 5000) {
    return {
      roleLabel: "爆点开场",
      roleHint: "先拆代表视频的开场钩子和转发点",
      operatorAction: "先拆代表视频的开场钩子和转发点，再顺着这个主题翻近90天高表现素材。"
    };
  }
  if (top.isStrong || Number(recent7dCount ?? 0) >= 3) {
    return {
      roleLabel: "起量抄法",
      roleHint: "先看这个主题最近起量的视频结构和脚本节奏",
      operatorAction: "先看这个主题最近起量的视频结构和脚本节奏，再回看同主题近3个月内容。"
    };
  }
  return {
    roleLabel: "长尾参考",
    roleHint: "先把这条代表视频当成长尾参考，再回看这个主题的稳定素材",
    operatorAction: "先把这条代表视频当成长尾参考，再回看这个主题近3个月稳定跑出的内容。"
  };
}

function parseMarkdownLink(value) {
  const text = String(value ?? "").trim();
  const match = /^\[(.+?)\]\((https?:\/\/.+)\)$/u.exec(text);
  if (!match) {
    return { label: text, url: "" };
  }
  return { label: match[1], url: match[2] };
}

function deriveThemeLabel(snapshot, account) {
  const primaryRef = Array.isArray(snapshot.productRefs) ? snapshot.productRefs.find((item) => item?.title || item?.productUrl || item?.shopUrl) : undefined;
  const sourceQuery = Array.isArray(account?.sourceQueries) ? String(account.sourceQueries[0] ?? "").trim() : "";
  const captionTheme = inferThemeFromCaption(snapshot.caption ?? "");
  const candidates = [
    String(primaryRef?.title ?? "").trim(),
    String(snapshot.primaryProductTitle ?? "").trim(),
    captionTheme,
    String(snapshot.sourceQuery ?? "").trim(),
    sourceQuery
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = canonicalizeThemeLabel(candidate);
    if (!normalized) continue;
    return normalized.length <= 32 ? normalized : normalized.slice(0, 32);
  }
  return "";
}

function latestStrongVideoByAccount({ videoSnapshots = [], now = new Date() }) {
  const latestByAccount = new Map();
  for (const video of buildRecentStrongVideoMap({ videoSnapshots, now }).values()) {
    const current = latestByAccount.get(video.accountHandle);
    if (!current || String(video.publishedAt ?? "") > String(current.publishedAt ?? "")) {
      latestByAccount.set(video.accountHandle, video);
    }
  }
  return latestByAccount;
}

function resolveSignalMetrics(signal) {
  return {
    views: Number(signal.currentMetrics?.views ?? signal.current?.views ?? 0),
    likes: Number(signal.currentMetrics?.likes ?? signal.current?.likes ?? 0),
    comments: Number(signal.currentMetrics?.comments ?? signal.current?.comments ?? 0),
    shares: Number(signal.currentMetrics?.shares ?? signal.current?.shares ?? 0)
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
}

function formatMultiple(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "0x";
  return `${number.toFixed(2)}x`;
}

function dedupeLatestSnapshots(snapshots = []) {
  const latestByUrl = new Map();
  for (const snapshot of snapshots) {
    const current = latestByUrl.get(snapshot.videoUrl);
    if (!current || String(snapshot.collectedAt ?? "") > String(current.collectedAt ?? "")) {
      latestByUrl.set(snapshot.videoUrl, snapshot);
    }
  }
  return [...latestByUrl.values()];
}

function ageHours(snapshot, now) {
  const publishedAt = resolveVideoPublishedAt(snapshot);
  if (!publishedAt) return Number.POSITIVE_INFINITY;
  return hoursBetween(new Date(publishedAt), now);
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length);
}

function watchLevelPriority(label = "") {
  if (/重点跟进/u.test(label)) return 1;
  if (/持续观察/u.test(label)) return 2;
  return 4;
}

function formatPercent(value) {
  return `${(Number(value ?? 0) * 100).toFixed(2)}%`;
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function resolveSignalKind(signal) {
  if (signal?.signalKind) return signal.signalKind;
  if (Number(signal?.windowHours ?? 0) <= 6) return "new_breakout";
  if (Number(signal?.windowHours ?? 0) <= 24) return "sustained_growth";
  return "long_tail_winner";
}

function inferSignalPriority(signal) {
  const kind = resolveSignalKind(signal);
  if (kind === "new_breakout") return 1;
  if (kind === "sustained_growth") return 2;
  return 3;
}

function inferSignalLabel(signal) {
  const kind = resolveSignalKind(signal);
  if (kind === "new_breakout") return "3天内新爆";
  if (kind === "sustained_growth") return "4-7天持续涨";
  return "8-15天长尾爆";
}

function filterSnapshotsWithinDays(snapshots, now, days) {
  return snapshots.filter((snapshot) => {
    const publishedAt = resolveTikTokVideoPostedAt(snapshot);
    if (!publishedAt) return false;
    return (now.getTime() - new Date(publishedAt).getTime()) / 86_400_000 <= days;
  });
}

function classifyAccountPriority({ signal, strongCount7d = 0, posts7d = 0 }) {
  if (signal?.signalKind === "new_breakout") return "重点跟进";
  if (signal?.signalKind === "sustained_growth" || strongCount7d >= 2) return "持续观察";
  if (strongCount7d >= 1 || posts7d > 0 || signal?.signalKind === "long_tail_winner") return "持续观察";
  return "普通观察";
}
