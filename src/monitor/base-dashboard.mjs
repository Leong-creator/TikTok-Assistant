import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { mergeCompetitorAccounts } from "./account-pool.mjs";
import { readJsonFile, readJsonLines, writeJsonFile } from "./storage.mjs";
import { buildLarkCliInvocation } from "./alerts.mjs";
import { isCanonicalTikTokVideoUrl, resolveTikTokVideoPostedAt } from "./video-time.mjs";
import { buildRecentStrongVideoMap, countRecentStrongVideosByAccount } from "./operator-ranking.mjs";
import { canonicalizeThemeLabel, inferThemeFromCaption } from "./theme-labels.mjs";
import { isWhitelistSourceConfigured, loadWhitelistAccounts } from "./whitelist-accounts.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_DASHBOARD_CONFIG_PATH = path.join("monitoring_data", "base_dashboard_config.json");
const DEFAULT_WHITELIST_BASE_DASHBOARD_CONFIG_PATH = path.join("monitoring_data", "base_dashboard_whitelist_config.json");
const ACCOUNT_TABLE_NAME = "同行账号池";
const VIDEO_TABLE_NAME = "视频素材池";
const THEME_TABLE_NAME = "主题参考库";
const RECENT_VIDEO_RETENTION_DAYS = 90;
const BASE_SCHEMA_SPEC = {
  accounts: {
    tableName: ACCOUNT_TABLE_NAME,
    fields: [
      { name: "账号排名", json: { name: "账号排名", type: "number" } },
      { name: "账号名", json: { name: "账号名", type: "text" } },
      { name: "主页", json: { name: "主页", type: "text" } },
      { name: "主页链接", json: { name: "主页链接", type: "text" } },
      { name: "来源表", json: { name: "来源表", type: "text" } },
      { name: "素材类型", json: { name: "素材类型", type: "text" } },
      { name: "备注", json: { name: "备注", type: "text" } },
      { name: "来源关键词", json: { name: "来源关键词", type: "text" } },
      { name: "最近发文时间", json: { name: "最近发文时间", type: "datetime" } },
      { name: "最近发布时间", json: { name: "最近发布时间", type: "datetime" } },
      { name: "最近更新时间", json: { name: "最近更新时间", type: "datetime" } },
      { name: "近90天视频数", json: { name: "近90天视频数", type: "number" } },
      { name: "近3个月视频数", json: { name: "近3个月视频数", type: "number" } },
      { name: "近7天发文数", json: { name: "近7天发文数", type: "number" } },
      { name: "近7天带货视频数", json: { name: "近7天带货视频数", type: "number" } },
      { name: "近7天好素材数", json: { name: "近7天好素材数", type: "number" } },
      { name: "近15天最高播放", json: { name: "近15天最高播放", type: "number" } },
      { name: "近7天最高点赞", json: { name: "近7天最高点赞", type: "number" } },
      { name: "近7天最高分享", json: { name: "近7天最高分享", type: "number" } },
      { name: "近期主打主题", json: { name: "近期主打主题", type: "text" } },
      { name: "最近一次起量时间", json: { name: "最近一次起量时间", type: "datetime" } },
      { name: "最近爆点标签", json: { name: "最近爆点标签", type: "text" } },
      { name: "最新爆点视频", json: { name: "最新爆点视频", type: "text" } },
      { name: "账号热度分", json: { name: "账号热度分", type: "number" } },
      {
        name: "重点等级",
        json: {
          name: "重点等级",
          type: "select",
          multiple: false,
          options: [
            { name: "重点跟进", hue: "Red", lightness: "Light" },
            { name: "持续观察", hue: "Orange", lightness: "Light" },
            { name: "普通观察", hue: "Gray", lightness: "Light" }
          ]
        }
      },
      {
        name: "追踪状态",
        json: {
          name: "追踪状态",
          type: "select",
          multiple: false,
          options: [
            { name: "追踪中", hue: "Green", lightness: "Light" },
            { name: "跳过", hue: "Gray", lightness: "Light" }
          ]
        }
      },
      {
        name: "视频记录",
        json: {
          name: "视频记录",
          type: "link",
          link_table: VIDEO_TABLE_NAME,
          bidirectional: true,
          bidirectional_link_field_name: "所属账号"
        }
      }
    ],
    obsoleteViews: ["Grid View", "同行账号总览", "账号雷达", "重点观察账号", "正在跟踪账号", "待确认账号候选", "重点账号"],
    views: [
      {
        name: "账号榜",
        visibleFields: ["账号排名", "账号", "最新爆点视频", "近期主打主题", "最近爆点标签", "近7天好素材数", "近15天最高播放", "重点等级"],
        sort: [{ field: "账号热度分", desc: true }, { field: "近7天好素材数", desc: true }, { field: "最近发文时间", desc: true }]
      },
      {
        name: "追踪账号表",
        visibleFields: ["账号名", "主页链接", "来源表", "素材类型", "备注", "追踪状态", "最近更新时间", "近90天视频数", "近7天发文数", "最近发布时间"],
        sort: [{ field: "最近发布时间", desc: true }, { field: "最近更新时间", desc: true }]
      }
    ]
  },
  videos: {
    tableName: VIDEO_TABLE_NAME,
    fields: [
      { name: "视频榜排名", json: { name: "视频榜排名", type: "number" } },
      { name: "预警排名", json: { name: "预警排名", type: "number" } },
      { name: "上新素材排名", json: { name: "上新素材排名", type: "number" } },
      { name: "账号", json: { name: "账号", type: "text" } },
      { name: "账号名", json: { name: "账号名", type: "text" } },
      { name: "来源表", json: { name: "来源表", type: "text" } },
      { name: "素材类型", json: { name: "素材类型", type: "text" } },
      { name: "发布时间", json: { name: "发布时间", type: "datetime" } },
      {
        name: "发布时间窗",
        json: {
          name: "发布时间窗",
          type: "select",
          multiple: false,
          options: [
            { name: "0-3天", hue: "Red", lightness: "Light" },
            { name: "4-7天", hue: "Orange", lightness: "Light" },
            { name: "8-15天", hue: "Yellow", lightness: "Light" },
            { name: "16-30天", hue: "Green", lightness: "Light" },
            { name: "31-90天", hue: "Gray", lightness: "Light" }
          ]
        }
      },
      { name: "文案摘要", json: { name: "文案摘要", type: "text" } },
      { name: "播放", json: { name: "播放", type: "number" } },
      { name: "点赞", json: { name: "点赞", type: "number" } },
      { name: "评论", json: { name: "评论", type: "number" } },
      { name: "分享", json: { name: "分享", type: "number" } },
      { name: "当前播放", json: { name: "当前播放", type: "number" } },
      { name: "当前点赞", json: { name: "当前点赞", type: "number" } },
      { name: "当前评论", json: { name: "当前评论", type: "number" } },
      { name: "当前转发", json: { name: "当前转发", type: "number" } },
      { name: "更新时间", json: { name: "更新时间", type: "datetime" } },
      { name: "上次播放", json: { name: "上次播放", type: "number" } },
      { name: "上次点赞", json: { name: "上次点赞", type: "number" } },
      { name: "上次评论", json: { name: "上次评论", type: "number" } },
      { name: "上次转发", json: { name: "上次转发", type: "number" } },
      { name: "上次更新时间", json: { name: "上次更新时间", type: "datetime" } },
      { name: "播放增量", json: { name: "播放增量", type: "number" } },
      { name: "点赞增量", json: { name: "点赞增量", type: "number" } },
      { name: "评论增量", json: { name: "评论增量", type: "number" } },
      { name: "转发增量", json: { name: "转发增量", type: "number" } },
      { name: "24h播放增量", json: { name: "24h播放增量", type: "number" } },
      { name: "24h点赞增量", json: { name: "24h点赞增量", type: "number" } },
      { name: "24h评论增量", json: { name: "24h评论增量", type: "number" } },
      { name: "24h转发增量", json: { name: "24h转发增量", type: "number" } },
      { name: "新发视频", json: { name: "新发视频", type: "checkbox" } },
      { name: "异常增长标签", json: { name: "异常增长标签", type: "text" } },
      { name: "提醒原因", json: { name: "提醒原因", type: "text" } },
      { name: "当前是否带货", json: { name: "当前是否带货", type: "checkbox" } },
      { name: "主推商品", json: { name: "主推商品", type: "text" } },
      { name: "店铺", json: { name: "店铺", type: "text" } },
      { name: "商品链接", json: { name: "商品链接", type: "text" } },
      { name: "最近采集时间", json: { name: "最近采集时间", type: "datetime" } },
      { name: "商品主题", json: { name: "商品主题", type: "text" } },
      { name: "分享率", json: { name: "分享率", type: "number" } },
      { name: "主题参考分", json: { name: "主题参考分", type: "number" } },
      { name: "主题参考原因", json: { name: "主题参考原因", type: "text" } },
      { name: "运营优先级", json: { name: "运营优先级", type: "number" } },
      { name: "运营热度分", json: { name: "运营热度分", type: "number" } },
      { name: "上榜原因", json: { name: "上榜原因", type: "text" } },
      {
        name: "榜单标签",
        json: {
          name: "榜单标签",
          type: "select",
          multiple: false,
          options: [
            { name: "3天内新爆", hue: "Red", lightness: "Light" },
            { name: "4-7天持续涨", hue: "Orange", lightness: "Light" },
            { name: "近7天好素材", hue: "Blue", lightness: "Light" },
            { name: "8-15天长尾爆", hue: "Yellow", lightness: "Light" }
          ]
        }
      },
      { name: "跟进建议", json: { name: "跟进建议", type: "text" } }
    ],
    obsoleteViews: ["Grid View", "视频快照", "近7天最佳新发", "待复盘内容池", "爆款跟踪", "近7天新发", "复盘池", "3天内新爆", "4-7天持续涨", "8-15天长尾爆", "今日必须看", "近7天好素材", "今日机会榜", "近7天上新榜", "视频总库", "主题素材库"],
    views: [
      {
        name: "爆点预警",
        aliases: ["今日必须看", "今日机会榜"],
        visibleFields: ["预警排名", "账号", "商品主题", "发布时间", "榜单标签", "24h播放增量", "点赞", "分享", "视频链接"],
        filter: { logic: "or", conditions: [["榜单标签", "==", "3天内新爆"], ["榜单标签", "==", "4-7天持续涨"], ["榜单标签", "==", "近7天好素材"]] },
        sort: [{ field: "运营热度分", desc: true }, { field: "24h播放增量", desc: true }, { field: "分享", desc: true }, { field: "点赞", desc: true }]
      },
      {
        name: "近7天上新好素材",
        aliases: ["近7天好素材", "近7天上新榜"],
        visibleFields: ["上新素材排名", "账号", "商品主题", "发布时间", "点赞", "分享", "播放", "视频链接"],
        filter: { logic: "and", conditions: [["榜单标签", "intersects", ["近7天好素材"]]] },
        sort: [{ field: "运营热度分", desc: true }, { field: "点赞", desc: true }, { field: "分享", desc: true }, { field: "播放", desc: true }]
      },
      {
        name: "视频榜",
        aliases: ["视频总库"],
        visibleFields: ["视频榜排名", "账号", "商品主题", "发布时间", "播放", "点赞", "分享", "视频链接"],
        sort: [{ field: "发布时间", desc: true }, { field: "24h播放增量", desc: true }, { field: "播放", desc: true }, { field: "运营热度分", desc: true }]
      },
      {
        name: "追踪视频表",
        visibleFields: ["发布时间", "视频链接", "账号名", "来源表", "素材类型", "当前播放", "当前点赞", "当前评论", "当前转发", "更新时间", "播放增量", "点赞增量", "评论增量", "转发增量", "异常增长标签"],
        sort: [{ field: "发布时间", desc: true }, { field: "更新时间", desc: true }]
      }
    ]
  },
  themes: {
    tableName: THEME_TABLE_NAME,
    fields: [
      { name: "主题排名", json: { name: "主题排名", type: "number" } },
      { name: "近3个月收录视频数", json: { name: "近3个月收录视频数", type: "number" } },
      { name: "近7天上新数", json: { name: "近7天上新数", type: "number" } },
      { name: "高表现视频数", json: { name: "高表现视频数", type: "number" } },
      { name: "最高播放", json: { name: "最高播放", type: "number" } },
      { name: "最高点赞", json: { name: "最高点赞", type: "number" } },
      { name: "最高分享", json: { name: "最高分享", type: "number" } },
      { name: "最近上榜时间", json: { name: "最近上榜时间", type: "datetime" } },
      { name: "代表账号", json: { name: "代表账号", type: "text" } },
      { name: "代表视频发布时间", json: { name: "代表视频发布时间", type: "datetime" } },
      { name: "代表视频链接", json: { name: "代表视频链接", type: "text" } },
      { name: "代表商品", json: { name: "代表商品", type: "text" } },
      { name: "主题热度分", json: { name: "主题热度分", type: "number" } },
      { name: "上榜原因", json: { name: "上榜原因", type: "text" } },
      { name: "跟进建议", json: { name: "跟进建议", type: "text" } },
      {
        name: "关联视频",
        json: {
          name: "关联视频",
          type: "link",
          link_table: VIDEO_TABLE_NAME,
          bidirectional: false
        }
      }
    ],
    obsoleteViews: ["Grid View", "主题参考", "主题库", "近3个月主题参考", "主题榜单"],
    views: [
      {
        name: "主题榜",
        aliases: ["主题素材库", "近3个月主题参考"],
        visibleFields: ["主题排名", "主题", "近7天上新数", "高表现视频数", "最高播放", "代表账号", "代表视频发布时间", "代表视频链接"],
        sort: [{ field: "主题热度分", desc: true }, { field: "近7天上新数", desc: true }, { field: "最高分享", desc: true }, { field: "最近上榜时间", desc: true }]
      }
    ]
  }
};

function createBaseSchemaSpec(tableNames = {}) {
  const resolvedNames = {
    accounts: tableNames.accounts ?? ACCOUNT_TABLE_NAME,
    videos: tableNames.videos ?? VIDEO_TABLE_NAME,
    themes: tableNames.themes ?? THEME_TABLE_NAME
  };
  const spec = structuredClone(BASE_SCHEMA_SPEC);
  spec.accounts.tableName = resolvedNames.accounts;
  spec.videos.tableName = resolvedNames.videos;
  spec.themes.tableName = resolvedNames.themes;
  const accountVideoLinkField = spec.accounts.fields.find((field) => field.name === "视频记录");
  if (accountVideoLinkField?.json) accountVideoLinkField.json.link_table = resolvedNames.videos;
  const themeVideoLinkField = spec.themes.fields.find((field) => field.name === "关联视频");
  if (themeVideoLinkField?.json) themeVideoLinkField.json.link_table = resolvedNames.videos;
  return spec;
}

export async function buildBaseDashboardRecords({ dataDir = "monitoring_data", whitelistAccounts, baseDashboardConfigPath } = {}) {
  const resolvedWhitelistAccounts = whitelistAccounts ?? await loadWhitelistAccounts({ dataDir, baseDashboardConfigPath });
  const whitelistConfigured = Array.isArray(whitelistAccounts)
    ? true
    : await isWhitelistSourceConfigured({ dataDir, baseDashboardConfigPath });
  if (whitelistConfigured) {
    return buildWhitelistDashboardRecords({ dataDir, whitelistAccounts: resolvedWhitelistAccounts });
  }
  const now = new Date();
  const accounts = await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const accountCandidates = await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []);
  const videoSnapshots = (await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl")))
    .filter((snapshot) => isCanonicalTikTokVideoUrl(snapshot?.videoUrl ?? ""));
  const signals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const latestSignalByVideo = latestByMap(signals.filter((signal) => signal.entityType === "video"), (signal) => signal.entityUrl);
  const latestSignalByAccount = latestByMap(signals.filter((signal) => signal.entityType === "video"), (signal) => signal.accountHandle);
  const strongVideoByUrl = buildRecentStrongVideoMap({ videoSnapshots, now });
  const strongVideoCountByAccount = countRecentStrongVideosByAccount({ videoSnapshots, now });
  const latestStrongVideoByAccount = latestStrongVideosByAccount(strongVideoByUrl);
  const latestProducts = latestBy(await readJsonLines(path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl")), (item) => item.productUrl ?? item.shopUrl);
  const productLookup = buildProductLookup(latestProducts);
  const accountRows = mergeCompetitorAccounts({ accounts, accountCandidates });
  const accountMap = new Map(accountRows.map((account) => [account.handle, account]));
  const videos = buildVideoMaterialPool({ videoSnapshots, now, productLookup, accountMap });
  const themes = buildThemeReferencePool({ videos, now });
  const videoCountsByAccount = countVideosByAccount(videos);
  const accountMetrics = summarizeAccountVideoMetrics(videos, accountMap);

  const accountRecords = accountRows.map((account) => ({
      key: account.handle,
      fields: materializeAccountOperatorFields({
        account,
        metrics: accountMetrics.get(account.handle),
        strongCount: Number(strongVideoCountByAccount.get(account.handle) ?? 0),
        latestSignal: latestSignalByAccount.get(account.handle),
        latestStrongVideo: latestStrongVideoByAccount.get(account.handle),
        videoCount: Number(videoCountsByAccount.get(account.handle) ?? 0)
      })
    }));
  const videoRecords = videos.map((video) => ({
      key: video.videoUrl,
      fields: {
        "视频链接": renderVideoCardLink({
          url: video.videoUrl,
          accountHandle: video.accountHandle,
          theme: resolveVideoDisplayTheme({
            video,
            account: accountMap.get(video.accountHandle),
            metrics: accountMetrics.get(video.accountHandle)
          }),
          publishedAt: video.publishedAt
        }),
        "账号": video.accountHandle ?? "",
        "发布时间": formatFeishuDatetime(video.publishedAt),
        "发布时间窗": video.ageBucket,
        "文案摘要": video.caption ?? "",
        "播放": Number(video.views ?? 0),
        "点赞": Number(video.likes ?? 0),
        "评论": Number(video.comments ?? 0),
        "分享": Number(video.shares ?? 0),
        "分享率": roundMetric(Number(video.views ?? 0) > 0 ? Number(video.shares ?? 0) / Number(video.views ?? 0) * 100 : 0, 2),
        "24h播放增量": Number(video.deltas.views ?? 0),
        "24h点赞增量": Number(video.deltas.likes ?? 0),
        "24h评论增量": Number(video.deltas.comments ?? 0),
        "24h转发增量": Number(video.deltas.shares ?? 0),
        "当前是否带货": Boolean(video.hasCommerce),
        "主推商品": video.primaryProductTitle ?? "",
        "店铺": video.primaryShopName ?? "",
        "商品链接": video.primaryProductUrl ?? video.primaryShopUrl ?? "",
        "最近采集时间": formatFeishuDatetime(video.collectedAt),
        "商品主题": resolveVideoDisplayTheme({
          video,
          account: accountMap.get(video.accountHandle),
          metrics: accountMetrics.get(video.accountHandle)
        }),
        ...deriveVideoOperatorFields({
          video,
          signal: latestSignalByVideo.get(video.videoUrl),
          strongVideo: strongVideoByUrl.get(video.videoUrl)
        })
      },
      links: {
        "所属账号": [{ kind: "accounts", rowKey: video.accountHandle }]
      }
    }));
  const themeRecords = themes.map((theme) => ({
      key: theme.theme,
      fields: {
        "主题": theme.theme,
        "近3个月收录视频数": theme.videoCount,
        "近7天上新数": theme.recent7dCount,
        "高表现视频数": theme.qualifiedCount,
        "最高播放": theme.topViews,
        "最高点赞": theme.topLikes,
        "最高分享": theme.topShares,
        "最近上榜时间": formatFeishuDatetime(theme.latestPublishedAt),
        "代表账号": renderNamedLink(theme.representativeAccount || "查看账号", accountMap.get(theme.representativeAccount)?.profileUrl ?? ""),
        "代表视频发布时间": formatFeishuDatetime(theme.representativePublishedAt),
        "代表视频链接": renderNamedLink("查看代表视频", theme.representativeVideoUrl),
        "代表商品": theme.representativeProductTitle,
        "主题热度分": theme.themeHeat,
        "上榜原因": theme.reason,
        "跟进建议": theme.operatorAction
      },
      links: {
        "关联视频": theme.videoUrls.map((videoUrl) => ({ kind: "videos", rowKey: videoUrl }))
      }
    }));

  assignSequentialRank({
    records: accountRecords,
    rankField: "账号排名",
    comparator: compareAccountRank
  });
  assignSequentialRank({
    records: videoRecords,
    rankField: "视频榜排名",
    comparator: compareVideoLibraryRank
  });
  assignSequentialRank({
    records: videoRecords,
    rankField: "预警排名",
    comparator: compareAlertRank,
    predicate: (record) => ["3天内新爆", "4-7天持续涨", "近7天好素材"].includes(String(record.fields["榜单标签"] ?? ""))
  });
  assignSequentialRank({
    records: videoRecords,
    rankField: "上新素材排名",
    comparator: compareRecentStrongRank,
    predicate: (record) => String(record.fields["榜单标签"] ?? "") === "近7天好素材"
  });
  assignSequentialRank({
    records: themeRecords,
    rankField: "主题排名",
    comparator: compareThemeRank
  });

  return {
    accounts: accountRecords,
    videos: videoRecords,
    themes: themeRecords
  };
}

async function buildWhitelistDashboardRecords({ dataDir = "monitoring_data", whitelistAccounts = [] } = {}) {
  const now = new Date();
  const videoSnapshots = (await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl")))
    .filter((snapshot) => isCanonicalTikTokVideoUrl(snapshot?.videoUrl ?? ""));
  const signals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const latestSignalByVideo = latestByMap(signals.filter((signal) => signal.entityType === "video"), (signal) => signal.entityUrl);
  const allAccounts = whitelistAccounts.filter((account) => account.enabled !== false);
  const activeAccounts = allAccounts.filter((account) => account.skipTracking !== true);
  const activeHandles = new Set(activeAccounts.map((account) => String(account.handle ?? "").trim()).filter(Boolean));
  const accountLookupById = new Map(allAccounts.map((account) => [account.id, account]));
  const accountLookupByHandle = new Map(activeAccounts.map((account) => [account.handle, account]));
  const baseVideos = buildVideoMaterialPool({
    videoSnapshots: videoSnapshots.filter((snapshot) => activeHandles.has(String(snapshot.accountHandle ?? "").trim())),
    now,
    productLookup: buildProductLookup([]),
    accountMap: accountLookupByHandle
  });
  const videos = activeAccounts.flatMap((account) =>
    baseVideos
      .filter((video) => String(video.accountHandle ?? "").trim() === String(account.handle ?? "").trim())
      .map((video) => ({
        ...video,
        rowAccountId: account.id,
        rowAccountName: account.accountName || account.handle,
        rowSourceTables: [...(account.sourceTables ?? [])],
        rowMaterialTypes: [...(account.materialTypes ?? [])],
        rowRemark: account.remark ?? "",
        rowKey: `${account.id}::${video.videoUrl}`
      }))
  );
  const videosByAccountRow = groupBy(videos, (video) => video.rowAccountId);
  const accountRecords = allAccounts.map((account) => {
    const accountVideos = [...(videosByAccountRow.get(account.id) ?? [])].sort((left, right) => String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? "")));
    const recent7dCount = accountVideos.filter((video) => Number(video.ageHours ?? Infinity) <= 24 * 7).length;
    return {
      key: account.id,
      fields: {
        "账号": account.accountName || account.handle,
        "账号名": account.accountName || account.handle,
        "主页": account.profileUrl ?? "",
        "主页链接": account.profileUrl ?? "",
        "来源表": [...(account.sourceTables ?? [])].join("｜"),
        "素材类型": [...(account.materialTypes ?? [])].join("｜"),
        "备注": account.remark ?? "",
        "追踪状态": account.skipTracking ? "跳过" : "追踪中",
        "最近更新时间": formatFeishuDatetime(latestIso(accountVideos.map((video) => video.collectedAt))),
        "近90天视频数": accountVideos.length,
        "近7天发文数": recent7dCount,
        "最近发布时间": formatFeishuDatetime(latestIso(accountVideos.map((video) => video.publishedAt)))
      },
      links: {
        "视频记录": accountVideos.map((video) => ({ kind: "videos", rowKey: video.rowKey }))
      }
    };
  });

  const videoRecords = videos.map((video) => {
    const account = accountLookupById.get(video.rowAccountId ?? "");
    const signal = latestSignalByVideo.get(video.videoUrl);
    const previous = findPreviousSnapshotForWindow(
      videoSnapshots.filter((snapshot) => snapshot.videoUrl === video.videoUrl),
      video.collectedAt
    );
    return {
      key: video.rowKey,
      fields: {
        "发布时间": formatFeishuDatetime(video.publishedAt),
        "视频链接": renderNamedLink("查看视频", video.videoUrl),
        "账号": video.rowAccountName ?? video.accountHandle ?? "",
        "账号名": video.rowAccountName ?? video.accountHandle ?? "",
        "来源表": [...(account?.sourceTables ?? [])].join("｜"),
        "素材类型": [...(account?.materialTypes ?? [])].join("｜"),
        "当前播放": Number(video.views ?? 0),
        "当前点赞": Number(video.likes ?? 0),
        "当前评论": Number(video.comments ?? 0),
        "当前转发": Number(video.shares ?? 0),
        "更新时间": formatFeishuDatetime(video.collectedAt),
        "上次播放": Number(previous?.views ?? 0),
        "上次点赞": Number(previous?.likes ?? 0),
        "上次评论": Number(previous?.comments ?? 0),
        "上次转发": Number(previous?.shares ?? 0),
        "上次更新时间": formatFeishuDatetime(previous?.collectedAt),
        "播放增量": Number(video.deltas.views ?? 0),
        "点赞增量": Number(video.deltas.likes ?? 0),
        "评论增量": Number(video.deltas.comments ?? 0),
        "转发增量": Number(video.deltas.shares ?? 0),
        "新发视频": Number(video.ageHours ?? Infinity) <= 24 ? true : false,
        "异常增长标签": signal?.signalLabel ?? "",
        "提醒原因": buildWhitelistReminderReason({ signal, video }),
        "跟进建议": String(signal?.operatorAction ?? "").trim()
      },
      links: {
        "所属账号": [{ kind: "accounts", rowKey: video.rowAccountId }]
      }
    };
  });

  const themes = buildThemeReferencePool({ videos, now }).map((theme) => ({
    key: theme.theme,
    fields: {
      "主题": theme.theme,
      "近3个月收录视频数": theme.videoCount,
      "近7天上新数": theme.recent7dCount,
      "高表现视频数": theme.qualifiedCount,
      "最高播放": theme.topViews,
      "最高点赞": theme.topLikes,
      "最高分享": theme.topShares,
      "最近上榜时间": formatFeishuDatetime(theme.latestPublishedAt),
      "代表账号": renderNamedLink(theme.representativeAccount || "查看账号", accountLookupByHandle.get(theme.representativeAccount)?.profileUrl ?? ""),
      "代表视频发布时间": formatFeishuDatetime(theme.representativePublishedAt),
      "代表视频链接": renderNamedLink("查看代表视频", theme.representativeVideoUrl),
      "代表商品": theme.representativeProductTitle,
      "主题热度分": theme.themeHeat,
      "上榜原因": theme.reason,
      "跟进建议": theme.operatorAction
    },
    links: {
      "关联视频": videos
        .filter((video) => theme.videoUrls.includes(video.videoUrl))
        .map((video) => ({ kind: "videos", rowKey: video.rowKey }))
    }
  }));

  return {
    accounts: accountRecords,
    videos: videoRecords,
    themes
  };
}

export async function syncFeishuBaseDashboard({
  dataDir = "monitoring_data",
  records,
  baseToken,
  tableMap,
  tableNames,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  dryRun = false,
  recordMapPath = path.join(dataDir, "base_record_map.json"),
  refreshRecordMap = true,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  baseDashboardConfigPath = await resolvePreferredBaseDashboardConfigPath({ dataDir, baseDashboardConfigPath });
  ({ baseToken, tableMap, tableNames } = await resolveBaseDashboardConfig({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    baseDashboardConfigPath
  }));
  if (!baseToken) throw new Error("baseToken is required");
  if (!tableMap) throw new Error("tableMap is required");
  const schemaSpec = createBaseSchemaSpec(tableNames);
  tableMap = await ensureBaseDashboardTables({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    schemaSpec,
    baseDashboardConfigPath,
    dryRun,
    larkCliPath,
    execFileImpl,
    platform
  });
  const dashboardRecords = records ?? await buildBaseDashboardRecords({ dataDir, baseDashboardConfigPath });
  let recordMap = await readJsonFile(recordMapPath, {});
  const commands = [];

  if (!dryRun && refreshRecordMap) {
    const hasCachedRecords = Object.keys(recordMap).length > 0;
    if (!hasCachedRecords) {
      await refreshFeishuBaseRecordMap({
        dataDir,
        records: dashboardRecords,
        baseToken,
        tableMap,
        recordMapPath,
        larkCliPath,
        execFileImpl,
        platform
      });
      recordMap = await readJsonFile(recordMapPath, {});
    }
  }

  for (const [kind, rows] of Object.entries(dashboardRecords)) {
    const tableId = tableMap[kind];
    if (!tableId || !rows.length) continue;
    for (const row of rows) {
      const mapKey = makeRecordMapKey({ kind, tableId, rowKey: row.key });
      const existingRecordId = recordMap[mapKey]?.recordId;
      const payload = materializeDashboardRowFields({ row, recordMap, tableMap });
      const args = [
        "base",
        "+record-upsert",
        "--base-token",
        baseToken,
        "--table-id",
        tableId
      ];
      if (existingRecordId) {
        args.push("--record-id", existingRecordId);
      }
      args.push(
        "--json",
        JSON.stringify(payload)
      );
      commands.push({ command: larkCliPath, args });
      const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
      if (!dryRun) {
        const { stdout } = await execLarkCliWithRetry(() =>
          execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
        );
        const recordId = extractRecordId(stdout) ?? existingRecordId;
        if (recordId) {
          recordMap[mapKey] = {
            recordId,
            kind,
            tableId,
            rowKey: row.key,
            updatedAt: new Date().toISOString()
          };
        }
      }
    }
  }

  if (!dryRun) {
    if (refreshRecordMap) {
      const refreshResult = await refreshFeishuBaseRecordMap({
        dataDir,
        records: dashboardRecords,
        baseToken,
        tableMap,
        recordMapPath,
        larkCliPath,
        execFileImpl,
        platform
      });
      return { dryRun, commands, recordMapPath, mappedRecordCount: refreshResult.mappedRecordCount };
    }
    await writeJsonFile(recordMapPath, recordMap);
  }

  return { dryRun, commands, recordMapPath };
}

export async function refreshFeishuBaseRecordMap({
  dataDir = "monitoring_data",
  records,
  baseToken,
  tableMap,
  tableNames,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  recordMapPath = path.join(dataDir, "base_record_map.json"),
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  ({ baseToken, tableMap, tableNames } = await resolveBaseDashboardConfig({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    baseDashboardConfigPath
  }));
  if (!baseToken) throw new Error("baseToken is required");
  if (!tableMap) throw new Error("tableMap is required");
  const schemaSpec = createBaseSchemaSpec(tableNames);
  tableMap = await ensureBaseDashboardTables({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    schemaSpec,
    baseDashboardConfigPath,
    dryRun: false,
    larkCliPath,
    execFileImpl,
    platform
  });
  const dashboardRecords = records ?? await buildBaseDashboardRecords({ dataDir, baseDashboardConfigPath });
  const recordMap = await readJsonFile(recordMapPath, {});
  let mappedRecordCount = 0;

  for (const [kind, rows] of Object.entries(dashboardRecords)) {
    const tableId = tableMap[kind];
    const keyField = dashboardKeyField(kind);
    if (!tableId || !keyField || !rows.length) continue;
    const expectedKeys = new Set(rows.map((row) => row.key));
    const staleRecordIds = new Set();
    for (const existingKey of Object.keys(recordMap)) {
      if (!existingKey.startsWith(`${kind}:${tableId}:`)) continue;
      const rowKey = existingKey.slice(`${kind}:${tableId}:`.length);
      if (!expectedKeys.has(rowKey)) {
        const recordId = recordMap[existingKey]?.recordId;
        if (recordId) staleRecordIds.add(recordId);
        delete recordMap[existingKey];
      }
    }
    let offset = 0;
    const pageLimit = 200;
    const seenRowKeys = new Set();
    for (;;) {
      const args = [
        "base",
        "+record-list",
        "--base-token",
        baseToken,
        "--table-id",
        tableId,
        "--offset",
        String(offset),
        "--limit",
        String(pageLimit),
        "--format",
        "json"
      ];
      const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
      const { stdout } = await execLarkCliWithRetry(() =>
        execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
      );
      const listed = parseRecordList(stdout);
      const fieldIndex = listed.fields.indexOf(keyField);
      if (fieldIndex >= 0) {
        for (let index = 0; index < listed.data.length; index += 1) {
          const rowKey = normalizeBaseCell(listed.data[index]?.[fieldIndex]);
          const recordId = listed.recordIds[index];
          if (!rowKey || !recordId) continue;
          if (!expectedKeys.has(rowKey)) {
            staleRecordIds.add(recordId);
            continue;
          }
          if (seenRowKeys.has(rowKey)) {
            staleRecordIds.add(recordId);
            continue;
          }
          seenRowKeys.add(rowKey);
          recordMap[makeRecordMapKey({ kind, tableId, rowKey })] = {
            recordId,
            kind,
            tableId,
            rowKey,
            updatedAt: new Date().toISOString()
          };
          mappedRecordCount += 1;
        }
      }
      if (listed.data.length < pageLimit) break;
      offset += pageLimit;
    }
    for (const recordId of staleRecordIds) {
      const args = [
        "base",
        "+record-delete",
        "--base-token",
        baseToken,
        "--table-id",
        tableId,
        "--record-id",
        recordId,
        "--yes"
      ];
      const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
      await execLarkCliWithRetry(() =>
        execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
      );
    }
  }

  await writeJsonFile(recordMapPath, recordMap);
  return { recordMapPath, mappedRecordCount };
}

function latestBy(items, keyFn) {
  const byKey = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || new Date(item.collectedAt ?? 0) >= new Date(current.collectedAt ?? 0)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function countVideosByAccount(videos) {
  const byAccount = new Map();
  for (const video of videos) {
    if (!video.accountHandle || !video.videoUrl) continue;
    const videoUrls = byAccount.get(video.accountHandle) ?? new Set();
    videoUrls.add(video.videoUrl);
    byAccount.set(video.accountHandle, videoUrls);
  }
  return new Map([...byAccount.entries()].map(([handle, videoUrls]) => [handle, videoUrls.size]));
}

export async function syncFeishuBaseSchema({
  dataDir = "monitoring_data",
  baseToken,
  tableMap,
  tableNames,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  dryRun = false,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  baseDashboardConfigPath = await resolvePreferredBaseDashboardConfigPath({ dataDir, baseDashboardConfigPath });
  ({ baseToken, tableMap, tableNames } = await resolveBaseDashboardConfig({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    baseDashboardConfigPath
  }));
  if (!baseToken) throw new Error("baseToken is required");
  if (!tableMap) throw new Error("tableMap is required");
  const schemaSpec = createBaseSchemaSpec(tableNames);
  tableMap = await ensureBaseDashboardTables({
    dataDir,
    baseToken,
    tableMap,
    tableNames,
    schemaSpec,
    baseDashboardConfigPath,
    dryRun,
    larkCliPath,
    execFileImpl,
    platform
  });

  const commands = [];
  const summary = {};

  for (const [kind, spec] of Object.entries(schemaSpec)) {
    const tableId = tableMap[kind];
    if (!tableId) continue;
    summary[kind] = { renamedTable: spec.tableName ?? "", createdFields: [], createdViews: [], updatedViews: [], deletedViews: [], archivedViews: [] };
    const migratedAliases = new Set();

    if (spec.tableName) {
      const renameArgs = ["base", "+table-update", "--base-token", baseToken, "--table-id", tableId, "--name", spec.tableName];
      commands.push({ command: larkCliPath, args: renameArgs });
      if (!dryRun) {
        await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: renameArgs }));
      }
    }

    const fields = await listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform });
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const views = await listBaseViews({ baseToken, tableId, larkCliPath, execFileImpl, platform });
    const viewByName = new Map(views.map((view) => [view.name, view]));

    let createdField = false;
    for (const fieldSpec of spec.fields) {
      if (fieldByName.has(fieldSpec.name)) continue;
      const fieldJson = materializeSchemaFieldJson({ fieldJson: fieldSpec.json, tableMap, schemaSpec });
      const args = ["base", "+field-create", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify(fieldJson)];
      commands.push({ command: larkCliPath, args });
      if (!dryRun) {
        await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args }));
      }
      summary[kind].createdFields.push(fieldSpec.name);
      fieldByName.set(fieldSpec.name, { name: fieldSpec.name });
      createdField = true;
    }

    if (createdField && !dryRun) {
      const refreshedFields = await listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform });
      fieldByName.clear();
      for (const field of refreshedFields) {
        fieldByName.set(field.name, field);
      }
    }

    for (const viewSpec of spec.views) {
      let view = viewByName.get(viewSpec.name);
      if (!view && Array.isArray(viewSpec.aliases)) {
        for (const alias of viewSpec.aliases) {
          const aliasedView = viewByName.get(alias);
          if (!aliasedView) continue;
          const renameArgs = ["base", "+view-rename", "--base-token", baseToken, "--table-id", tableId, "--view-id", aliasedView.id, "--name", viewSpec.name];
          commands.push({ command: larkCliPath, args: renameArgs });
          if (!dryRun) {
            await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: renameArgs }));
            view = await findBaseViewByName({ baseToken, tableId, name: viewSpec.name, larkCliPath, execFileImpl, platform });
          } else {
            view = { id: aliasedView.id, name: viewSpec.name };
          }
          migratedAliases.add(alias);
          if (view) break;
        }
      }
      if (!view) {
        const createArgs = ["base", "+view-create", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify({ name: viewSpec.name, type: "grid" })];
        commands.push({ command: larkCliPath, args: createArgs });
        if (!dryRun) {
          await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: createArgs }));
          view = await findBaseViewByName({ baseToken, tableId, name: viewSpec.name, larkCliPath, execFileImpl, platform });
        } else {
          view = { id: `dryrun-${viewSpec.name}`, name: viewSpec.name };
        }
        summary[kind].createdViews.push(viewSpec.name);
      }
      if (!view?.id) {
        continue;
      }

      const visibleFields = (viewSpec.visibleFields ?? []).map((name) => fieldByName.get(name)?.id ?? name).filter(Boolean);
      const updateSteps = [];

      if (visibleFields.length) {
        updateSteps.push({
          args: [
            "base", "+view-set-visible-fields", "--base-token", baseToken, "--table-id", tableId, "--view-id", view.id,
            "--json", JSON.stringify({ visible_fields: visibleFields })
          ]
        });
      }
      if (viewSpec.sort?.length) {
        updateSteps.push({
          args: [
            "base", "+view-set-sort", "--base-token", baseToken, "--table-id", tableId, "--view-id", view.id,
            "--json", JSON.stringify({ sort_config: viewSpec.sort.map((item) => ({ field: fieldByName.get(item.field)?.id ?? item.field, desc: Boolean(item.desc) })) })
          ]
        });
      }
      updateSteps.push({
        args: [
          "base", "+view-set-filter", "--base-token", baseToken, "--table-id", tableId, "--view-id", view.id,
          "--json", JSON.stringify(serializeViewFilter(viewSpec.filter ?? { conditions: [] }, fieldByName))
        ]
      });

      for (const step of updateSteps) {
        commands.push({ command: larkCliPath, args: step.args });
        if (!dryRun) {
          await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: step.args }));
        }
      }
      summary[kind].updatedViews.push(viewSpec.name);
    }

    for (const obsoleteViewName of spec.obsoleteViews ?? []) {
      if (migratedAliases.has(obsoleteViewName)) continue;
      const obsoleteView = viewByName.get(obsoleteViewName);
      if (!obsoleteView) continue;
      const deleteArgs = ["base", "+view-delete", "--base-token", baseToken, "--table-id", tableId, "--view-id", obsoleteView.id, "--yes"];
      commands.push({ command: larkCliPath, args: deleteArgs });
      if (!dryRun) {
        try {
          await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: deleteArgs }));
          summary[kind].deletedViews.push(obsoleteViewName);
          continue;
        } catch (error) {
          if (!isLimitedViewDeleteError(error)) {
            throw error;
          }
          const archivedName = archiveViewName(obsoleteViewName);
          const renameArgs = ["base", "+view-rename", "--base-token", baseToken, "--table-id", tableId, "--view-id", obsoleteView.id, "--name", archivedName];
          commands.push({ command: larkCliPath, args: renameArgs });
          await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args: renameArgs }));
          summary[kind].archivedViews.push(`${obsoleteViewName} -> ${archivedName}`);
          continue;
        }
      }
      summary[kind].deletedViews.push(obsoleteViewName);
    }
  }

  return { dryRun, commands, summary };
}

function latestByMap(items, keyFn) {
  const byKey = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || String(item.detectedAt ?? item.collectedAt ?? "") >= String(current.detectedAt ?? current.collectedAt ?? "")) {
      byKey.set(key, item);
    }
  }
  return byKey;
}

function summarizeAccountVideoMetrics(videos, accountMap = new Map()) {
  const byAccount = new Map();
  for (const video of videos) {
    if (!video?.accountHandle) continue;
    if (!byAccount.has(video.accountHandle)) byAccount.set(video.accountHandle, []);
    byAccount.get(video.accountHandle).push(video);
  }

  const metrics = new Map();
  for (const [handle, items] of byAccount.entries()) {
    const account = accountMap.get(handle);
    const recent7d = items.filter((item) => item.ageHours <= 24 * 7);
    const recent15d = items.filter((item) => item.ageHours <= 24 * 15);
    const representativeRecentVideo = [...recent7d].sort((left, right) => {
      if (Number(right.shares ?? 0) !== Number(left.shares ?? 0)) return Number(right.shares ?? 0) - Number(left.shares ?? 0);
      if (Number(right.likes ?? 0) !== Number(left.likes ?? 0)) return Number(right.likes ?? 0) - Number(left.likes ?? 0);
      if (Number(right.views ?? 0) !== Number(left.views ?? 0)) return Number(right.views ?? 0) - Number(left.views ?? 0);
      return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
    })[0];
    const representativeFallbackVideo = [...recent15d.length ? recent15d : items].sort((left, right) => {
      if (Number(right.views ?? 0) !== Number(left.views ?? 0)) return Number(right.views ?? 0) - Number(left.views ?? 0);
      if (Number(right.likes ?? 0) !== Number(left.likes ?? 0)) return Number(right.likes ?? 0) - Number(left.likes ?? 0);
      return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
    })[0];
    metrics.set(handle, {
      latestPublishedAt: latestIso(items.map((item) => item.publishedAt)),
      posts7d: recent7d.length,
      topViews15d: Math.max(0, ...recent15d.map((item) => Number(item.views ?? 0))),
      topLikes7d: Math.max(0, ...recent7d.map((item) => Number(item.likes ?? 0))),
      topShares7d: Math.max(0, ...recent7d.map((item) => Number(item.shares ?? 0))),
      commercePosts7d: recent7d.filter((item) => item.hasCommerce).length,
      primaryTheme7d: pickDominantTheme(recent7d) || pickDominantTheme(recent15d) || pickDominantTheme(items) || pickThemeFallback(account) || "待补主题",
      representativeVideoUrl7d: representativeRecentVideo?.videoUrl ?? representativeFallbackVideo?.videoUrl ?? "",
      representativeFallbackVideoUrl: representativeFallbackVideo?.videoUrl ?? ""
    });
  }
  return metrics;
}

function classifyAccountPriority({ signal, strongCount = 0, recentPosts = 0 }) {
  if (signal?.signalKind === "new_breakout") return "重点跟进";
  if (signal?.signalKind === "sustained_growth" || strongCount >= 2) return "持续观察";
  if (strongCount >= 1 || recentPosts > 0 || signal?.signalKind === "long_tail_winner") return "持续观察";
  return "普通观察";
}

function materializeAccountOperatorFields({ account, metrics, strongCount = 0, latestSignal, latestStrongVideo, videoCount = 0 }) {
  const safeMetrics = metrics ?? {};
  return {
    "账号": account.handle,
    "主页": account.profileUrl ?? "",
    "来源关键词": (account.sourceQueries ?? []).join(", "),
    "最近发文时间": formatFeishuDatetime(safeMetrics.latestPublishedAt),
    "近3个月视频数": Number(videoCount ?? 0),
    "近7天发文数": Number(safeMetrics.posts7d ?? 0),
    "近7天带货视频数": Number(safeMetrics.commercePosts7d ?? 0),
    "近7天好素材数": Number(strongCount ?? 0),
    "近15天最高播放": Number(safeMetrics.topViews15d ?? 0),
    "近7天最高点赞": Number(safeMetrics.topLikes7d ?? 0),
    "近7天最高分享": Number(safeMetrics.topShares7d ?? 0),
    "近期主打主题": safeMetrics.primaryTheme7d ?? pickThemeFallback(account) ?? "待补主题",
    "最近一次起量时间": formatFeishuDatetime(latestSignal?.detectedAt ?? latestStrongVideo?.publishedAt),
    "最近爆点标签": latestSignal?.signalLabel ?? latestStrongVideo?.label ?? "",
    "最新爆点视频": renderNamedLink(
      "查看视频",
      latestSignal?.entityUrl ?? safeMetrics.representativeVideoUrl7d ?? safeMetrics.representativeFallbackVideoUrl ?? ""
    ),
    "重点等级": classifyAccountPriority({
      signal: latestSignal,
      strongCount: Number(strongCount ?? 0),
      recentPosts: Number(safeMetrics.posts7d ?? 0)
    }),
    "账号热度分": scoreAccountHeat({
      recentPosts: Number(safeMetrics.posts7d ?? 0),
      commercePosts: Number(safeMetrics.commercePosts7d ?? 0),
      strongCount: Number(strongCount ?? 0),
      topViews15d: Number(safeMetrics.topViews15d ?? 0),
      topLikes7d: Number(safeMetrics.topLikes7d ?? 0),
      topShares7d: Number(safeMetrics.topShares7d ?? 0),
      signalKind: latestSignal?.signalKind
    })
  };
}

function resolveVideoDisplayTheme({ video, account, metrics }) {
  return String(
    video?.productTheme ??
      metrics?.primaryTheme7d ??
      pickThemeFallback(account) ??
      "待补主题"
  ).trim() || "待补主题";
}

function pickThemeFallback(account) {
  const sourceQueries = Array.isArray(account?.sourceQueries) ? account.sourceQueries : [];
  return canonicalizeThemeLabel(String(sourceQueries[0] ?? account?.sourceQuery ?? "").trim());
}

function deriveVideoOperatorFields({ video, signal, strongVideo }) {
  const activeSignal = video.ageHours > 24 * 15 ? undefined : signal;
  const candidates = [];
  if (activeSignal?.signalLabel) {
    candidates.push({
      label: activeSignal.signalLabel,
      priority: Number(activeSignal.signalPriority ?? inferOperatorPriority(activeSignal.signalLabel)),
      action: activeSignal.operatorAction ?? activeSignal.recommendedAction ?? "继续观察下一轮数据。",
      latestViewsDelta: Number(video.deltas?.views ?? activeSignal.deltas?.views ?? 0)
      ,
      score: scoreVideoHeat({
        label: activeSignal.signalLabel,
        deltas: activeSignal.deltas ?? video.deltas ?? {},
        views: Number(video.views ?? 0),
        likes: Number(video.likes ?? 0),
        shares: Number(video.shares ?? 0),
        benchmark: activeSignal.benchmark ?? {}
      }),
      reason: buildVideoRankReason({
        label: activeSignal.signalLabel,
        deltas: activeSignal.deltas ?? video.deltas ?? {},
        benchmark: activeSignal.benchmark ?? {},
        reasons: activeSignal.reasons ?? []
      })
    });
  }
  if (strongVideo?.label) {
    candidates.push({
      label: strongVideo.label,
      priority: Number(strongVideo.priority ?? inferOperatorPriority(strongVideo.label)),
      latestViewsDelta: Number(video.deltas?.views ?? 0),
      action: strongVideo.operatorAction ?? "优先进入复盘池，拆解高表现素材。",
      score: scoreVideoHeat({
        label: strongVideo.label,
        deltas: video.deltas ?? {},
        views: Number(video.views ?? 0),
        likes: Number(video.likes ?? 0),
        shares: Number(video.shares ?? 0),
        benchmark: {}
      }),
      reason: buildVideoRankReason({
        label: strongVideo.label,
        deltas: video.deltas ?? {},
        benchmark: {},
        reasons: strongVideo.reasons ?? []
      })
    });
  }
  const selected = candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.priority - right.priority;
  })[0];
  const themeReference = deriveThemeReferenceFields({ video, signal: activeSignal, strongVideo });
  return {
    "榜单标签": selected?.label ?? "",
    "运营优先级": Number(selected?.priority ?? 99),
    "运营热度分": Number(selected?.score ?? scoreVideoHeat({
      label: "",
      deltas: video.deltas ?? {},
      views: Number(video.views ?? 0),
      likes: Number(video.likes ?? 0),
      shares: Number(video.shares ?? 0),
      benchmark: {}
    })),
    "上榜原因": selected?.reason ?? buildVideoRankReason({ label: "", deltas: video.deltas ?? {}, benchmark: {}, reasons: [] }),
    "跟进建议": selected?.action ?? themeReference.action ?? "",
    "主题参考分": Number(themeReference.score ?? 0),
    "主题参考原因": themeReference.reason ?? ""
  };
}

function deriveThemeReferenceFields({ video, signal, strongVideo }) {
  const views = Number(video.views ?? 0);
  const likes = Number(video.likes ?? 0);
  const shares = Number(video.shares ?? 0);
  const comments = Number(video.comments ?? 0);
  const isStrong = Boolean(strongVideo?.label);
  const hasSignal = Boolean(signal?.signalLabel);
  const score =
    (hasSignal ? 50 : 0) +
    (isStrong ? 35 : 0) +
    Math.min(10, views / 100000) +
    Math.min(10, likes / 2000) +
    Math.min(10, shares / 200);
  const qualifies =
    hasSignal ||
    isStrong ||
    likes >= 1000 ||
    shares >= 100 ||
    comments >= 50 ||
    views >= 10000;
  const reasons = [];
  if (signal?.signalLabel) reasons.push(signal.signalLabel);
  if (strongVideo?.label === "近7天好素材") reasons.push("近7天好素材");
  if (likes >= 1000) reasons.push("点赞过千");
  if (shares >= 100) reasons.push("转发过百");
  if (comments >= 50) reasons.push("评论过线");
  if (views >= 10000) reasons.push("播放过万");
  return {
    score: qualifies ? Math.max(1, Math.min(100, Math.round(score))) : 0,
    reason: qualifies ? [...new Set(reasons)].join(" / ") : "",
    action: qualifies ? "优先放入主题参考库，回看近3个月同主题高表现视频。" : ""
  };
}

function inferOperatorPriority(label = "") {
  if (label === "3天内新爆") return 1;
  if (label === "4-7天持续涨") return 2;
  if (label === "近7天好素材") return 3;
  if (label === "8-15天长尾爆") return 4;
  return 99;
}

function scoreAccountHeat({ recentPosts = 0, commercePosts = 0, strongCount = 0, topViews15d = 0, topLikes7d = 0, topShares7d = 0, signalKind = "" }) {
  const signalBonus =
    signalKind === "new_breakout" ? 25 :
    signalKind === "sustained_growth" ? 18 :
    signalKind === "long_tail_winner" ? 10 : 0;
  const score =
    signalBonus +
    Math.min(30, strongCount * 18) +
    Math.min(14, recentPosts * 2) +
    Math.min(10, commercePosts * 3) +
    Math.min(12, topLikes7d / 400) +
    Math.min(12, topShares7d / 80) +
    Math.min(22, topViews15d / 10000);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function pickDominantTheme(videos = []) {
  const byTheme = new Map();
  for (const video of videos) {
    const theme = String(video.productTheme ?? "").trim();
    if (!theme) continue;
    const current = byTheme.get(theme) ?? {
      theme,
      count: 0,
      topShares: 0,
      topViews: 0,
      latestPublishedAt: ""
    };
    current.count += 1;
    current.topShares = Math.max(current.topShares, Number(video.shares ?? 0));
    current.topViews = Math.max(current.topViews, Number(video.views ?? 0));
    current.latestPublishedAt = [current.latestPublishedAt, String(video.publishedAt ?? "")].filter(Boolean).sort().at(-1) ?? current.latestPublishedAt;
    byTheme.set(theme, current);
  }
  return [...byTheme.values()]
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.topShares !== left.topShares) return right.topShares - left.topShares;
      if (right.topViews !== left.topViews) return right.topViews - left.topViews;
      return String(right.latestPublishedAt).localeCompare(String(left.latestPublishedAt));
    })[0]?.theme ?? "";
}

function scoreThemeHeat({ recent7dCount = 0, qualifiedCount = 0, topViews = 0, topLikes = 0, topShares = 0 }) {
  const score =
    Math.min(26, recent7dCount * 6) +
    Math.min(30, qualifiedCount * 5) +
    Math.min(16, topViews / 10000) +
    Math.min(14, topLikes / 500) +
    Math.min(14, topShares / 80);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildThemeReason({ recent7dCount = 0, qualifiedCount = 0, representative }) {
  const parts = [];
  if (recent7dCount > 0) parts.push(`近7天上新${recent7dCount}条`);
  if (qualifiedCount > 0) parts.push(`高表现视频${qualifiedCount}条`);
  if (Number(representative?.shares ?? 0) >= 100) parts.push(`代表视频分享${formatNumber(representative.shares)}`);
  else if (Number(representative?.likes ?? 0) >= 1000) parts.push(`代表视频点赞${formatNumber(representative.likes)}`);
  else if (Number(representative?.views ?? 0) >= 10000) parts.push(`代表视频播放${formatNumber(representative.views)}`);
  return parts.join(" / ");
}

function scoreVideoHeat({ label = "", deltas = {}, views = 0, likes = 0, shares = 0, benchmark = {} }) {
  const labelBase =
    label === "3天内新爆" ? 88 :
    label === "4-7天持续涨" ? 82 :
    label === "近7天好素材" ? 72 :
    label === "8-15天长尾爆" ? 64 : 18;
  const deltaBoost = Math.min(18, Number(deltas.views ?? 0) / 5000) + Math.min(10, Number(deltas.shares ?? 0) / 50) + Math.min(8, Number(deltas.likes ?? 0) / 200);
  const scaleBoost = Math.min(10, Number(views ?? 0) / 100000) + Math.min(6, Number(likes ?? 0) / 2000) + Math.min(6, Number(shares ?? 0) / 200);
  const benchmarkBoost = Math.min(12, Number(benchmark.viewMultiple ?? 0) / 5) + Math.min(8, Number(benchmark.shareMultiple ?? 0) / 5);
  return Math.max(0, Math.min(100, Math.round(labelBase + deltaBoost + scaleBoost + benchmarkBoost)));
}

function buildVideoRankReason({ label = "", deltas = {}, benchmark = {}, reasons = [] }) {
  if (label === "近7天好素材" && reasons.length) {
    return reasons.join(" / ");
  }
  const reasonParts = [];
  if (Number(deltas.views ?? 0) > 0) reasonParts.push(`24h播放+${formatNumber(Number(deltas.views ?? 0))}`);
  if (Number(deltas.shares ?? 0) > 0) reasonParts.push(`24h转发+${formatNumber(Number(deltas.shares ?? 0))}`);
  if (Number(deltas.likes ?? 0) > 0) reasonParts.push(`24h点赞+${formatNumber(Number(deltas.likes ?? 0))}`);
  if (Number(benchmark.viewMultiple ?? 0) > 1) reasonParts.push(`高于常规${formatMultiple(benchmark.viewMultiple)}`);
  if (Number(benchmark.shareMultiple ?? 0) > 1) reasonParts.push(`转发效率${formatMultiple(benchmark.shareMultiple)}`);
  if (!reasonParts.length && reasons.length) return reasons.join(" / ");
  return reasonParts.join(" / ");
}

function latestStrongVideosByAccount(strongVideoByUrl) {
  const latestByAccount = new Map();
  for (const strongVideo of strongVideoByUrl.values()) {
    if (!strongVideo?.accountHandle) continue;
    const current = latestByAccount.get(strongVideo.accountHandle);
    if (!current || String(strongVideo.publishedAt ?? "") > String(current.publishedAt ?? "")) {
      latestByAccount.set(strongVideo.accountHandle, strongVideo);
    }
  }
  return latestByAccount;
}

function resolveVideoPublishedAt(snapshot) {
  return resolveTikTokVideoPostedAt(snapshot);
}

function formatAgeBucket(publishedAt, now = new Date()) {
  if (!publishedAt) return "";
  const ageHours = (now.getTime() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageHours <= 24 * 3) return "0-3天";
  if (ageHours <= 24 * 7) return "4-7天";
  if (ageHours <= 24 * 15) return "8-15天";
  if (ageHours <= 24 * 30) return "16-30天";
  return "31-90天";
}

function roundMetric(value, precision = 0) {
  const factor = 10 ** precision;
  return Math.round(Number(value ?? 0) * factor) / factor;
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function formatMultiple(value) {
  return `${Number(value ?? 0).toFixed(2)}x`;
}

function assignSequentialRank({ records = [], rankField, comparator, predicate = () => true }) {
  const ranked = [...records]
    .filter((record) => predicate(record))
    .sort(comparator);
  for (const [index, record] of ranked.entries()) {
    record.fields[rankField] = index + 1;
  }
}

function compareNumberDesc(left, right) {
  return Number(right ?? 0) - Number(left ?? 0);
}

function compareTextDesc(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function compareAccountRank(left, right) {
  const heatDiff = compareNumberDesc(left.fields["账号热度分"], right.fields["账号热度分"]);
  if (heatDiff !== 0) return heatDiff;
  const strongDiff = compareNumberDesc(left.fields["近7天好素材数"], right.fields["近7天好素材数"]);
  if (strongDiff !== 0) return strongDiff;
  return compareTextDesc(left.fields["最近发文时间"], right.fields["最近发文时间"]);
}

function compareVideoLibraryRank(left, right) {
  const publishDiff = compareTextDesc(left.fields["发布时间"], right.fields["发布时间"]);
  if (publishDiff !== 0) return publishDiff;
  const deltaDiff = compareNumberDesc(left.fields["24h播放增量"], right.fields["24h播放增量"]);
  if (deltaDiff !== 0) return deltaDiff;
  const viewsDiff = compareNumberDesc(left.fields["播放"], right.fields["播放"]);
  if (viewsDiff !== 0) return viewsDiff;
  return compareNumberDesc(left.fields["运营热度分"], right.fields["运营热度分"]);
}

function compareAlertRank(left, right) {
  const heatDiff = compareNumberDesc(left.fields["运营热度分"], right.fields["运营热度分"]);
  if (heatDiff !== 0) return heatDiff;
  const deltaDiff = compareNumberDesc(left.fields["24h播放增量"], right.fields["24h播放增量"]);
  if (deltaDiff !== 0) return deltaDiff;
  const shareDiff = compareNumberDesc(left.fields["分享"], right.fields["分享"]);
  if (shareDiff !== 0) return shareDiff;
  return compareNumberDesc(left.fields["点赞"], right.fields["点赞"]);
}

function compareRecentStrongRank(left, right) {
  const heatDiff = compareNumberDesc(left.fields["运营热度分"], right.fields["运营热度分"]);
  if (heatDiff !== 0) return heatDiff;
  const likesDiff = compareNumberDesc(left.fields["点赞"], right.fields["点赞"]);
  if (likesDiff !== 0) return likesDiff;
  const shareDiff = compareNumberDesc(left.fields["分享"], right.fields["分享"]);
  if (shareDiff !== 0) return shareDiff;
  return compareNumberDesc(left.fields["播放"], right.fields["播放"]);
}

function compareThemeRank(left, right) {
  const heatDiff = compareNumberDesc(left.fields["主题热度分"], right.fields["主题热度分"]);
  if (heatDiff !== 0) return heatDiff;
  const recentDiff = compareNumberDesc(left.fields["近7天上新数"], right.fields["近7天上新数"]);
  if (recentDiff !== 0) return recentDiff;
  const shareDiff = compareNumberDesc(left.fields["最高分享"], right.fields["最高分享"]);
  if (shareDiff !== 0) return shareDiff;
  return compareTextDesc(left.fields["最近上榜时间"], right.fields["最近上榜时间"]);
}

async function resolveBaseDashboardConfig({
  dataDir = "monitoring_data",
  baseToken,
  tableMap,
  tableNames,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json")
} = {}) {
  baseDashboardConfigPath = await resolvePreferredBaseDashboardConfigPath({ dataDir, baseDashboardConfigPath });
  if (baseToken && tableMap) return { baseToken, tableMap, tableNames };
  const config = await readJsonFile(baseDashboardConfigPath, {});
  return {
    baseToken: baseToken ?? config.baseToken,
    tableMap: tableMap ?? config.tableMap,
    tableNames: tableNames ?? config.tableNames
  };
}

async function ensureBaseDashboardTables({
  dataDir = "monitoring_data",
  baseToken,
  tableMap = {},
  tableNames,
  schemaSpec = createBaseSchemaSpec(tableNames),
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  dryRun = false,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  baseDashboardConfigPath = await resolvePreferredBaseDashboardConfigPath({ dataDir, baseDashboardConfigPath });
  if (!baseToken) throw new Error("baseToken is required");
  const config = await readJsonFile(baseDashboardConfigPath, {});
  const nextTableMap = { ...(config.tableMap ?? {}), ...(tableMap ?? {}) };
  if (dryRun) return nextTableMap;
  if (Object.keys(schemaSpec).every((kind) => nextTableMap[kind])) {
    return nextTableMap;
  }
  const tables = await listBaseTables({ baseToken, larkCliPath, execFileImpl, platform });
  const tableByName = new Map(tables.map((table) => [table.name, table.id]));
  let changed = false;

  for (const [kind, spec] of Object.entries(schemaSpec)) {
    if (nextTableMap[kind]) continue;
    const existingId = tableByName.get(spec.tableName);
    if (existingId) {
      nextTableMap[kind] = existingId;
      changed = true;
      continue;
    }
    if (dryRun) continue;
    const createdId = await createBaseTable({
      baseToken,
      name: spec.tableName,
      keyFieldName: dashboardKeyField(kind),
      larkCliPath,
      execFileImpl,
      platform
    });
    nextTableMap[kind] = createdId;
    changed = true;
  }

  if (changed && !dryRun) {
    await writeJsonFile(baseDashboardConfigPath, {
      ...config,
      baseToken: config.baseToken ?? baseToken,
      tableNames: tableNames ?? config.tableNames,
      tableMap: nextTableMap
    });
  }
  return nextTableMap;
}

async function resolvePreferredBaseDashboardConfigPath({ dataDir = "monitoring_data", baseDashboardConfigPath } = {}) {
  const explicitDefaultPath = path.join(dataDir, "base_dashboard_config.json");
  if (baseDashboardConfigPath && baseDashboardConfigPath !== explicitDefaultPath) {
    return baseDashboardConfigPath;
  }
  const whitelistConfigPath = path.join(dataDir, "base_dashboard_whitelist_config.json");
  const whitelistConfig = await readJsonFile(whitelistConfigPath, null);
  if (whitelistConfig?.baseToken) {
    return whitelistConfigPath;
  }
  return baseDashboardConfigPath ?? explicitDefaultPath;
}

function makeRecordMapKey({ kind, tableId, rowKey }) {
  return `${kind}:${tableId}:${rowKey}`;
}

function extractRecordId(stdout) {
  if (!stdout) return undefined;
  try {
    const parsed = JSON.parse(stdout);
    return parsed.record?.record_id
      ?? parsed.record?.id
      ?? parsed.data?.record?.record_id
      ?? parsed.data?.record?.id
      ?? parsed.record_id
      ?? parsed.id;
  } catch {
    return undefined;
  }
}

function extractTableId(stdout) {
  if (!stdout) return undefined;
  try {
    const parsed = JSON.parse(stdout);
    return parsed.data?.table_id
      ?? parsed.data?.table?.id
      ?? parsed.table_id
      ?? parsed.table?.id
      ?? parsed.id;
  } catch {
    return undefined;
  }
}

function dashboardKeyField(kind) {
  return {
    accounts: "账号",
    videos: "视频链接",
    themes: "主题"
  }[kind];
}

function buildVideoMaterialPool({ videoSnapshots, now, productLookup, accountMap = new Map() }) {
  const grouped = groupBy(videoSnapshots, (snapshot) => snapshot.videoUrl);
  const videos = [];
  for (const snapshots of grouped.values()) {
    const sorted = [...snapshots]
      .filter((snapshot) => snapshot?.videoUrl && isCanonicalTikTokVideoUrl(snapshot.videoUrl) && snapshot?.collectedAt)
      .sort((left, right) => String(left.collectedAt).localeCompare(String(right.collectedAt)));
    if (!sorted.length) continue;
    const latest = sorted.at(-1);
    const publishedAt = resolveVideoPublishedAt(latest);
    if (!publishedAt) continue;
    const ageHours = (now.getTime() - new Date(publishedAt).getTime()) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > RECENT_VIDEO_RETENTION_DAYS * 24) continue;
    const previous = findPreviousSnapshot(sorted, latest, 30);
    const commerce = resolvePrimaryProductInfo(latest.productRefs ?? [], productLookup);
    const account = accountMap.get(latest.accountHandle ?? "");
    videos.push({
      ...latest,
      publishedAt,
      ageHours,
      ageBucket: formatAgeBucket(publishedAt, now),
      deltas: {
        views: previous ? numberDelta(previous.views, latest.views) : 0,
        likes: previous ? numberDelta(previous.likes, latest.likes) : 0,
        comments: previous ? numberDelta(previous.comments, latest.comments) : 0,
        shares: previous ? numberDelta(previous.shares, latest.shares) : 0
      },
      hasCommerce: commerce.hasCommerce,
      primaryProductTitle: commerce.primaryProductTitle,
      primaryProductUrl: commerce.primaryProductUrl,
      primaryShopName: commerce.primaryShopName,
      primaryShopUrl: commerce.primaryShopUrl,
      productTheme: deriveProductTheme({ latest, commerce, account })
    });
  }
  const themeByAccount = new Map();
  for (const [handle, items] of groupBy(videos, (video) => video.accountHandle).entries()) {
    const account = accountMap.get(handle ?? "");
    themeByAccount.set(handle, pickDominantTheme(items) || pickThemeFallback(account) || "待补主题");
  }
  return videos
    .map((video) => ({
      ...video,
      productTheme: String(video.productTheme ?? "").trim() || themeByAccount.get(video.accountHandle) || "待补主题"
    }))
    .sort((left, right) => String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? "")));
}

function buildThemeReferencePool({ videos = [], now = new Date() }) {
  const grouped = new Map();
  for (const video of videos) {
    const theme = String(video.productTheme ?? "").trim();
    if (!theme || theme === "待补主题") continue;
    const themeReference = deriveThemeReferenceFields({ video, signal: undefined, strongVideo: undefined });
    if (!grouped.has(theme)) grouped.set(theme, []);
    grouped.get(theme).push({
      ...video,
      themeReferenceScore: Number(themeReference.score ?? 0)
    });
  }

  return [...grouped.entries()]
    .map(([theme, items]) => {
      const qualifying = items.filter((item) => Number(item.themeReferenceScore ?? 0) > 0);
      if (!qualifying.length) return undefined;
      const recent7d = items.filter((item) => Number(item.ageHours ?? Infinity) <= 24 * 7);
      const representative = [...qualifying].sort((left, right) => {
        if (Number(right.themeReferenceScore ?? 0) !== Number(left.themeReferenceScore ?? 0)) {
          return Number(right.themeReferenceScore ?? 0) - Number(left.themeReferenceScore ?? 0);
        }
        if (Number(right.shares ?? 0) !== Number(left.shares ?? 0)) return Number(right.shares ?? 0) - Number(left.shares ?? 0);
        if (Number(right.likes ?? 0) !== Number(left.likes ?? 0)) return Number(right.likes ?? 0) - Number(left.likes ?? 0);
        if (Number(right.views ?? 0) !== Number(left.views ?? 0)) return Number(right.views ?? 0) - Number(left.views ?? 0);
        return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
      })[0];
      const topViews = Math.max(0, ...items.map((item) => Number(item.views ?? 0)));
      const topLikes = Math.max(0, ...items.map((item) => Number(item.likes ?? 0)));
      const topShares = Math.max(0, ...items.map((item) => Number(item.shares ?? 0)));
      return {
        theme,
        videoCount: items.length,
        recent7dCount: recent7d.length,
        qualifiedCount: qualifying.length,
        topViews,
        topLikes,
        topShares,
        latestPublishedAt: latestIso(items.map((item) => item.publishedAt)),
        representativeAccount: representative.accountHandle ?? "",
        representativePublishedAt: representative.publishedAt ?? "",
        representativeVideoUrl: representative.videoUrl ?? "",
        representativeProductTitle: representative.primaryProductTitle ?? "",
        themeHeat: scoreThemeHeat({
          recent7dCount: recent7d.length,
          qualifiedCount: qualifying.length,
          topViews,
          topLikes,
          topShares
        }),
        reason: buildThemeReason({ recent7dCount: recent7d.length, qualifiedCount: qualifying.length, representative }),
        operatorAction:
          Number(representative.themeReferenceScore ?? 0) >= 60
            ? "先看代表视频，再回看近3个月同主题高表现素材。"
            : "关注这个主题近7天新上内容，观察是否继续起量。",
        videoUrls: [...new Set(items.map((item) => item.videoUrl).filter(Boolean))].slice(0, 120)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.themeHeat !== left.themeHeat) return right.themeHeat - left.themeHeat;
      if (right.recent7dCount !== left.recent7dCount) return right.recent7dCount - left.recent7dCount;
      return String(right.latestPublishedAt ?? "").localeCompare(String(left.latestPublishedAt ?? ""));
    });
}

function deriveProductTheme({ latest, commerce, account }) {
  const sourceQuery = Array.isArray(account?.sourceQueries) ? String(account.sourceQueries[0] ?? "").trim() : "";
  const captionTheme = inferThemeFromCaption(latest?.caption);
  const candidates = [
    String(commerce.primaryProductTitle ?? "").trim(),
    captionTheme,
    sourceQuery
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = canonicalizeThemeLabel(candidate);
    if (!normalized) continue;
    if (normalized.length <= 32) return normalized;
    return normalized.slice(0, 32);
  }
  return "";
}

function resolvePrimaryProductInfo(productRefs, productLookup) {
  const refs = normalizeProductRefs(productRefs);
  const primary = refs[0];
  if (!primary) {
    return {
      hasCommerce: false,
      primaryProductTitle: "",
      primaryProductUrl: "",
      primaryShopName: "",
      primaryShopUrl: ""
    };
  }
  const product = primary.productUrl ? productLookup.byProductUrl.get(primary.productUrl) : undefined;
  const shop = primary.shopUrl ? productLookup.byShopUrl.get(primary.shopUrl) : undefined;
  return {
    hasCommerce: true,
    primaryProductTitle: product?.title ?? primary.title ?? "",
    primaryProductUrl: primary.productUrl ?? product?.productUrl ?? "",
    primaryShopName: shop?.shopName ?? product?.shopName ?? primary.shopName ?? "",
    primaryShopUrl: primary.shopUrl ?? shop?.shopUrl ?? ""
  };
}

function normalizeProductRefs(productRefs = []) {
  return productRefs
    .map((ref) => {
      if (!ref) return undefined;
      if (typeof ref === "string") {
        return ref.includes("/shop/p/")
          ? { productUrl: ref }
          : { shopUrl: ref };
      }
      return {
        productUrl: ref.productUrl ?? "",
        shopUrl: ref.shopUrl ?? "",
        shopName: ref.shopName ?? "",
        title: ref.title ?? ""
      };
    })
    .filter(Boolean)
    .filter((ref) => ref.productUrl || ref.shopUrl);
}

function buildProductLookup(products) {
  const byProductUrl = new Map();
  const byShopUrl = new Map();
  for (const product of products) {
    if (product?.productUrl) byProductUrl.set(product.productUrl, product);
    if (product?.shopUrl) byShopUrl.set(product.shopUrl, product);
  }
  return { byProductUrl, byShopUrl };
}

function latestIso(values) {
  return values.filter(Boolean).sort().at(-1) ?? "";
}

function findPreviousSnapshotForWindow(snapshots = [], currentCollectedAt) {
  return [...snapshots]
    .filter((snapshot) => String(snapshot.collectedAt ?? "") < String(currentCollectedAt ?? ""))
    .sort((left, right) => String(right.collectedAt ?? "").localeCompare(String(left.collectedAt ?? "")))[0];
}

function buildWhitelistReminderReason({ signal, video }) {
  if (signal?.signalLabel) return String(signal.signalLabel).trim();
  if (Number(video?.deltas?.views ?? 0) > 0 || Number(video?.deltas?.likes ?? 0) > 0 || Number(video?.deltas?.shares ?? 0) > 0) {
    return "增量更新";
  }
  if (Number(video?.ageHours ?? Infinity) <= 24) return "新发视频";
  return "";
}

function findPreviousSnapshot(sorted, current, maxHours) {
  const currentTime = new Date(current.collectedAt);
  return [...sorted]
    .slice(0, -1)
    .reverse()
    .find((snapshot) => (currentTime.getTime() - new Date(snapshot.collectedAt).getTime()) / 3_600_000 <= maxHours);
}

function numberDelta(previous, current) {
  return Number(current ?? 0) - Number(previous ?? 0);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function materializeDashboardRowFields({ row, recordMap, tableMap }) {
  const fields = { ...row.fields };
  for (const [fieldName, refs] of Object.entries(row.links ?? {})) {
    const resolved = refs
      .map((ref) => {
        const tableId = tableMap[ref.kind];
        if (!tableId) return undefined;
        const recordId = recordMap[makeRecordMapKey({ kind: ref.kind, tableId, rowKey: ref.rowKey })]?.recordId;
        return recordId ? { id: recordId } : undefined;
      })
      .filter(Boolean);
    if (resolved.length) {
      fields[fieldName] = resolved;
    }
  }
  return fields;
}

function parseRecordList(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return {
      fields: parsed.data?.fields ?? [],
      data: parsed.data?.data ?? [],
      recordIds: parsed.data?.record_id_list ?? []
    };
  } catch {
    return { fields: [], data: [], recordIds: [] };
  }
}

function normalizeBaseCell(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return normalizeBaseCell(value[0]);
  if (typeof value === "object") return normalizeBaseCell(value.text ?? value.link ?? value.url ?? "");
  const text = String(value).trim();
  const markdownLink = text.match(/^\[[^\]]*\]\(([^)]+)\)$/u);
  return markdownLink ? markdownLink[1] : text;
}

function formatFeishuDatetime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function renderVideoCardLink({ url, accountHandle, theme, publishedAt }) {
  if (!url) return "";
  const parts = [
    accountHandle || "unknown",
    theme || "待补主题",
    formatShortShanghaiDate(publishedAt)
  ].filter(Boolean);
  return renderNamedLink(parts.join("｜"), url);
}

function renderNamedLink(label, url) {
  const safeLabel = String(label ?? "").trim();
  const safeUrl = String(url ?? "").trim();
  if (!safeUrl) return "";
  return `[${safeLabel || "查看"}](${safeUrl})`;
}

function formatShortShanghaiDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}/${values.day}`;
}

async function execLarkCliWithRetry(run, attempts = 5) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run();
    } catch (error) {
      if (isNoOpLarkError(error)) {
        return { stdout: JSON.stringify({ ok: true, skipped: true }), stderr: "" };
      }
      lastError = error;
      if (!isRetryableLarkError(error) || index === attempts - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isRetryableLarkError(error) {
  const message = String(error?.message ?? "");
  return /EOF/u.test(message) || /ECONNRESET|ETIMEDOUT|socket hang up|server time out error|timeout/ui.test(message);
}

function isNoOpLarkError(error) {
  const message = String(error?.message ?? "");
  return /no operation produced/u.test(message) || /800070003/u.test(message);
}

function isLimitedViewDeleteError(error) {
  const message = String(error?.message ?? "");
  return /OpenAPIDeleteView limited/u.test(message) || /800004135/u.test(message);
}

async function listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--offset", "0", "--limit", "200"];
  const { stdout } = await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args }));
  const parsed = JSON.parse(stdout);
  return parsed.data?.fields ?? [];
}

async function listBaseTables({ baseToken, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+table-list", "--base-token", baseToken, "--offset", "0", "--limit", "200"];
  const { stdout } = await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args }));
  const parsed = JSON.parse(stdout);
  return parsed.data?.tables ?? [];
}

async function createBaseTable({ baseToken, name, keyFieldName, larkCliPath, execFileImpl, platform }) {
  const args = [
    "base",
    "+table-create",
    "--base-token",
    baseToken,
    "--name",
    name,
    "--fields",
    JSON.stringify([{ name: keyFieldName, type: "text" }])
  ];
  const { stdout } = await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args }));
  const tableId = extractTableId(stdout);
  if (!tableId) throw new Error(`failed to create Base table ${name}: missing table id`);
  return tableId;
}

async function listBaseViews({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+view-list", "--base-token", baseToken, "--table-id", tableId, "--offset", "0", "--limit", "200"];
  const { stdout } = await execLarkCliWithRetry(() => runLarkCli({ larkCliPath, platform, execFileImpl, args }));
  const parsed = JSON.parse(stdout);
  return parsed.data?.views ?? [];
}

async function findBaseViewByName({ baseToken, tableId, name, larkCliPath, execFileImpl, platform }) {
  const views = await listBaseViews({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  return views.find((view) => view.name === name);
}

function serializeViewFilter(filter, fieldByName) {
  return {
    logic: filter.logic ?? "and",
    conditions: (filter.conditions ?? []).map((condition) => {
      const [field, operator, value] = condition;
      return value === undefined
        ? [fieldByName.get(field)?.id ?? field, operator]
        : [fieldByName.get(field)?.id ?? field, operator, value];
    })
  };
}

function materializeSchemaFieldJson({ fieldJson, tableMap, schemaSpec = BASE_SCHEMA_SPEC }) {
  if (!fieldJson || typeof fieldJson !== "object") return fieldJson;
  const json = structuredClone(fieldJson);
  if (json.type === "link" && typeof json.link_table === "string") {
    const linkedKind = Object.entries(schemaSpec).find(([, spec]) => spec.tableName === json.link_table)?.[0];
    if (linkedKind && tableMap?.[linkedKind]) {
      json.link_table = tableMap[linkedKind];
    }
  }
  return json;
}

function archiveViewName(name) {
  return name.startsWith("归档-") ? name : `归档-${name}`;
}

function runLarkCli({ larkCliPath, platform, execFileImpl, args }) {
  const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
  return execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
}
