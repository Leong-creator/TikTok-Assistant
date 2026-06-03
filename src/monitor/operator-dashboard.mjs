import path from "node:path";

import { readJsonFile } from "./storage.mjs";
import { buildBaseDashboardRecords } from "./base-dashboard.mjs";
import { buildMonitorReport } from "./reporting.mjs";

export async function buildOperatorDashboardData({
  dataDir = "monitoring_data",
  now = new Date(),
  baseUrl,
  maxMustWatch = 6,
  maxRecentStrong = 8,
  maxAccountRank = 12,
  maxThemeRank = 8
} = {}) {
  const [dashboardRecords, baseConfig] = await Promise.all([
    buildBaseDashboardRecords({ dataDir }),
    readJsonFile(path.join(dataDir, "base_dashboard_config.json"), {})
  ]);
  const report = await buildMonitorReport({
    dataDir,
    now,
    maxSignals: Math.max(maxMustWatch, maxRecentStrong, maxThemeRank),
    baseUrl,
    dashboardRecords
  });

  const accounts = dashboardRecords.accounts
    .map((record) => mapAccountRecord(record))
    .sort((left, right) => left.rank - right.rank);
  const videos = dashboardRecords.videos
    .map((record) => mapVideoRecord(record))
    .sort(compareVideoLibrary);
  const themes = dashboardRecords.themes
    .map((record) => mapThemeRecord(record))
    .sort((left, right) => left.rank - right.rank);

  const mustWatch = report.summary.topMustWatchVideos.slice(0, maxMustWatch).map((item, index) => ({
    rank: index + 1,
    accountHandle: item.accountHandle || "unknown",
    entityUrl: item.entityUrl,
    publishedAt: item.publishedAt || "",
    label: item.label || "重点内容",
    views: Number(item.metrics?.views ?? 0),
    likes: Number(item.metrics?.likes ?? 0),
    shares: Number(item.metrics?.shares ?? 0),
    comments: Number(item.metrics?.comments ?? 0),
    deltaViews: Number(item.deltas?.views ?? 0),
    deltaLikes: Number(item.deltas?.likes ?? 0),
    deltaShares: Number(item.deltas?.shares ?? 0),
    viewMultiple: Number(item.benchmark?.viewMultiple ?? 0),
    theme: lookupTheme(videos, item.entityUrl, item.accountHandle),
    action: item.operatorAction || ""
  }));

  const recentStrong = report.summary.topRecentStrongVideos.slice(0, maxRecentStrong).map((item, index) => ({
    rank: index + 1,
    accountHandle: item.accountHandle || "unknown",
    entityUrl: item.entityUrl,
    publishedAt: item.publishedAt || "",
    views: Number(item.metrics?.views ?? 0),
    likes: Number(item.metrics?.likes ?? 0),
    shares: Number(item.metrics?.shares ?? 0),
    comments: Number(item.metrics?.comments ?? 0),
    shareRate: Number(item.rates?.share ?? 0),
    theme: lookupTheme(videos, item.entityUrl, item.accountHandle),
    action: item.operatorAction || ""
  }));

  const signalBreakdown = countSignalBreakdown(report.summary.topSignals ?? []);
  const actionPlan = buildActionPlan({ mustWatch, recentStrong, themes, accounts });
  const watchAccounts = (report.summary.watchAccounts ?? []).map((item, index) => ({
    rank: index + 1,
    handle: item.accountHandle || "",
    profileUrl: item.profileUrl || "",
    watchLevel: item.watchLevel || "",
    posts7d: Number(item.posts7d ?? 0),
    strongCount7d: Number(item.strongCount7d ?? 0),
    hotTheme: item.hotTheme || "待补主题",
    topViews15d: Number(item.topViews15d ?? 0),
    latestHotVideoUrl: item.latestHotVideoUrl || "",
    lastSignalAt: item.lastSignalAt || ""
  }));
  const headline = buildHeadline({ mustWatch, recentStrong, themes, watchAccounts });
  const topNewBreakout = mustWatch.find((item) => /3天内新爆/u.test(item.label)) || mustWatch[0];
  const topSustained = mustWatch.find((item) => /4-7天持续涨/u.test(item.label));
  const topWatchAccount = accounts[0];
  const topTheme = themes[0];
  const topRecentStrong = recentStrong[0];

  return {
    generatedAt: new Date(now).toISOString(),
    latestCollectionAt: report.summary.latestCollectionAt || "",
    baseUrl: baseUrl ?? report.summary.baseUrl ?? baseConfig?.url ?? "",
    headline,
    stats: {
      totalAccounts: accounts.length,
      totalVideos: videos.length
    },
    cards: [
      {
        key: "newBreakout",
        label: "今日头号爆点",
        value: signalBreakdown.newBreakout,
        tone: "hot",
        summary: topNewBreakout
          ? topNewBreakout.accountHandle
          : "今天暂时没有头号爆点",
        directive: topNewBreakout
          ? `${topNewBreakout.label}｜24h播放 +${formatCompact(topNewBreakout.deltaViews)}`
          : "先回到爆点预警看今天有没有新机会",
        href: topNewBreakout?.entityUrl || ""
      },
      {
        key: "themeFocus",
        label: "今日先回看主题",
        value: themes.length,
        tone: "violet",
        summary: topTheme
          ? topTheme.theme
          : "当前没有主题机会",
        directive: topTheme
          ? `近7天上新 ${formatCompact(topTheme.recent7dCount)}｜高表现 ${formatCompact(topTheme.qualifiedCount)}`
          : "先回看主题榜里最近还能继续扩的主题",
        href: topTheme?.representativeVideoUrl || ""
      },
      {
        key: "sustainedGrowth",
        label: "今日可直接抄",
        value: report.summary.recentStrongCount,
        tone: "mint",
        summary: topRecentStrong
          ? topRecentStrong.accountHandle
          : "今天没有新的近期强素材",
        directive: topRecentStrong
          ? `点赞 ${formatCompact(topRecentStrong.likes)}｜分享 ${formatCompact(topRecentStrong.shares)}`
          : "先回到近7天好素材看最新可抄对象",
        href: topRecentStrong?.entityUrl || ""
      },
      {
        key: "watchAccounts",
        label: "今天先盯账号",
        value: watchAccounts.length,
        tone: "warm",
        summary: topWatchAccount
          ? topWatchAccount.handle
          : "当前没有重点账号",
        directive: topWatchAccount
          ? `${topWatchAccount.theme}｜近7天好素材 ${formatCompact(topWatchAccount.strongCount7d)}`
          : "先回到账号榜看今天最值得盯的同行",
        href: topWatchAccount?.latestVideoUrl || topWatchAccount?.profileUrl || ""
      },
    ],
    signalBreakdown,
    actionPlan,
    mustWatch,
    recentStrong,
    topCompetitors: accounts.slice(0, 3),
    watchAccounts,
    accountRank: accounts.slice(0, maxAccountRank),
    themeRank: themes.slice(0, maxThemeRank),
    accounts,
    videos,
    themes,
    summaryText: report.text
  };
}

function mapAccountRecord(record) {
  const fields = record?.fields ?? {};
  const latestVideoLink = parseMarkdownLink(fields["最新爆点视频"]);
  return {
    key: record.key,
    handle: String(fields["账号名"] ?? fields["账号"] ?? record.key ?? ""),
    profileUrl: String(fields["主页链接"] ?? fields["主页"] ?? ""),
    sourceQuery: String(fields["来源表"] ?? fields["来源关键词"] ?? ""),
    theme: String(fields["近期主打主题"] ?? "待补主题"),
    posts7d: Number(fields["近7天发文数"] ?? 0),
    strongCount7d: Number(fields["近7天好素材数"] ?? 0),
    recentLabel: String(fields["最近爆点标签"] ?? fields["追踪状态"] ?? ""),
    topViews15d: Number(fields["近15天最高播放"] ?? 0),
    watchLevel: String(fields["重点等级"] ?? fields["追踪状态"] ?? ""),
    latestSignalAt: String(fields["最近一次起量时间"] ?? fields["最近更新时间"] ?? ""),
    latestVideoUrl: latestVideoLink.url || "",
    latestVideoLabel: latestVideoLink.label || "查看视频",
    rank: Number(fields["账号排名"] ?? 9999)
  };
}

function mapVideoRecord(record) {
  const fields = record?.fields ?? {};
  const videoLink = parseMarkdownLink(fields["视频链接"]);
  return {
    key: record.key,
    url: record.key || videoLink.url || "",
    title: videoLink.label || "查看视频",
    accountHandle: String(fields["所属账号"] ?? fields["账号"] ?? ""),
    publishedAt: String(fields["发布时间"] ?? ""),
    ageBucket: String(fields["发布时间窗"] ?? ""),
    theme: String(fields["商品主题"] ?? fields["来源表"] ?? "待补主题"),
    views: Number(fields["当前播放"] ?? fields["播放"] ?? 0),
    likes: Number(fields["当前点赞"] ?? fields["点赞"] ?? 0),
    comments: Number(fields["当前评论"] ?? fields["评论"] ?? 0),
    shares: Number(fields["当前转发"] ?? fields["分享"] ?? 0),
    deltaViews24h: Number(fields["播放增量"] ?? fields["24h播放增量"] ?? 0),
    deltaLikes24h: Number(fields["点赞增量"] ?? fields["24h点赞增量"] ?? 0),
    deltaShares24h: Number(fields["转发增量"] ?? fields["24h转发增量"] ?? 0),
    label: String(fields["异常增长标签"] ?? fields["榜单标签"] ?? ""),
    action: String(fields["跟进建议"] ?? ""),
    rank: Number(fields["视频榜排名"] ?? 999999)
  };
}

function mapThemeRecord(record) {
  const fields = record?.fields ?? {};
  const representativeAccount = parseMarkdownLink(fields["代表账号"]);
  const representativeVideo = parseMarkdownLink(fields["代表视频链接"]);
  const recent7dCount = Number(fields["近7天上新数"] ?? 0);
  const qualifiedCount = Number(fields["高表现视频数"] ?? 0);
  const topViews = Number(fields["最高播放"] ?? 0);
  const role = classifyThemeBoardRole({ recent7dCount, qualifiedCount, topViews });
  return {
    key: record.key,
    theme: String(fields["主题"] ?? record.key ?? ""),
    videoCount: Number(fields["近3个月收录视频数"] ?? 0),
    recent7dCount,
    qualifiedCount,
    topViews,
    topLikes: Number(fields["最高点赞"] ?? 0),
    topShares: Number(fields["最高分享"] ?? 0),
    latestPublishedAt: String(fields["最近上榜时间"] ?? ""),
    representativeAccount: representativeAccount.label || "",
    representativeAccountUrl: representativeAccount.url || "",
    representativeVideoUrl: representativeVideo.url || "",
    representativePublishedAt: String(fields["代表视频发布时间"] ?? ""),
    reason: String(fields["上榜原因"] ?? ""),
    action: String(fields["跟进建议"] ?? ""),
    roleLabel: role.roleLabel,
    roleHint: role.roleHint,
    rank: Number(fields["主题排名"] ?? 9999)
  };
}

function classifyThemeBoardRole({ recent7dCount = 0, qualifiedCount = 0, topViews = 0 }) {
  if (qualifiedCount >= 80 || topViews >= 3000000) {
    return {
      roleLabel: "重点扩题",
      roleHint: "先拆代表视频，再顺着这个主题扩一批同类型选题"
    };
  }
  if (recent7dCount >= 5 || qualifiedCount >= 40) {
    return {
      roleLabel: "持续起量",
      roleHint: "优先看最近7天的新内容，找还在起量的结构"
    };
  }
  return {
    roleLabel: "稳定参考",
    roleHint: "回看近3个月稳定跑出来的题材和开场"
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

function lookupTheme(videos, entityUrl, accountHandle) {
  const byUrl = videos.find((video) => video.url === entityUrl);
  if (byUrl?.theme) return byUrl.theme;
  const byAccount = videos.find((video) => video.accountHandle === accountHandle && video.theme && video.theme !== "待补主题");
  return byAccount?.theme || "待补主题";
}

function compareVideoLibrary(left, right) {
  const publishedCompare = String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""));
  if (publishedCompare !== 0) return publishedCompare;
  if (right.deltaViews24h !== left.deltaViews24h) return right.deltaViews24h - left.deltaViews24h;
  if (right.views !== left.views) return right.views - left.views;
  return left.rank - right.rank;
}

function countSignalBreakdown(topSignals = []) {
  const buckets = {
    newBreakout: 0,
    sustainedGrowth: 0,
    longTail: 0
  };
  for (const signal of topSignals) {
    const label = String(signal.signalLabel ?? signal.label ?? signal.signalKind ?? "");
    if (/3天内新爆/u.test(label)) buckets.newBreakout += 1;
    else if (/4-7天持续涨/u.test(label)) buckets.sustainedGrowth += 1;
    else if (/8-15天长尾爆/u.test(label)) buckets.longTail += 1;
  }
  return buckets;
}

function buildActionPlan({ mustWatch = [], recentStrong = [], themes = [], accounts = [] }) {
  const plan = [];
  const topBreakout = mustWatch[0];
  if (topBreakout) {
    plan.push({
      tone: "hot",
      stepLabel: "头号爆点",
      title: topBreakout.accountHandle,
      summary: topBreakout.label,
      reason: `24h +${formatCompact(topBreakout.deltaViews)}｜分享 ${formatCompact(topBreakout.shares)}`,
      href: topBreakout.entityUrl,
      metricValue: `+${formatCompact(topBreakout.deltaViews)}`,
      metricLabel: "24h播放增量",
      subMetric: `分享 ${formatCompact(topBreakout.shares)}`
    });
  }
  const topStrong = recentStrong[0];
  const topTheme = themes[0];
  if (topTheme) {
    plan.push({
      tone: "violet",
      stepLabel: "主题先翻",
      title: topTheme.theme,
      summary: `高表现 ${formatCompact(topTheme.qualifiedCount)}｜近7天上新 ${formatCompact(topTheme.recent7dCount)}`,
      reason: `先看代表视频｜${topTheme.representativeAccount || "待补账号"}`,
      href: topTheme.representativeVideoUrl,
      metricValue: formatCompact(topTheme.qualifiedCount),
      metricLabel: "高表现视频",
      subMetric: `近7天上新 ${formatCompact(topTheme.recent7dCount)}`
    });
  }
  if (topStrong) {
    plan.push({
      tone: "mint",
      stepLabel: "再抄近期",
      title: topStrong.accountHandle,
      summary: "近7天好素材",
      reason: `点赞 ${formatCompact(topStrong.likes)}｜分享率 ${(topStrong.shareRate * 100).toFixed(2)}%`,
      href: topStrong.entityUrl,
      metricValue: formatCompact(topStrong.likes),
      metricLabel: "当前点赞",
      subMetric: `分享率 ${(topStrong.shareRate * 100).toFixed(2)}%`
    });
  }
  const topAccount = accounts[0];
  if (topAccount) {
    plan.push({
      tone: "warm",
      stepLabel: "先盯账号",
      title: topAccount.handle,
      summary: `${topAccount.recentLabel || "重点同行"}｜近7天好素材 ${formatCompact(topAccount.strongCount7d)}`,
      reason: `${topAccount.theme || "待补主题"}｜先点最近代表视频`,
      href: topAccount.latestVideoUrl
    });
  }
  return plan.slice(0, 3);
}

function buildHeadline({ mustWatch = [], recentStrong = [], themes = [], watchAccounts = [] }) {
  const parts = [];
  const topBreakout = mustWatch[0];
  if (topBreakout) {
    parts.push(`新爆 ${topBreakout.accountHandle}｜24h +${formatCompact(topBreakout.deltaViews)}`);
  }
  const topRecent = recentStrong[0];
  const topTheme = themes[0];
  if (topTheme) {
    parts.push(`主题 ${topTheme.theme}`);
  }
  if (topRecent) {
    parts.push(`近期 ${topRecent.accountHandle}`);
  }
  const topAccount = watchAccounts[0];
  if (topAccount) {
    parts.push(`账号 ${topAccount.handle}`);
  }
  return parts.join("｜");
}

function formatCompact(value) {
  const number = Number(value ?? 0);
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return new Intl.NumberFormat("zh-CN").format(number);
}
