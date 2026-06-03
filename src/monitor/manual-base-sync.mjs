import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { buildLarkCliInvocation } from "./alerts.mjs";
import { buildBaseDashboardRecords } from "./base-dashboard.mjs";
import { readJsonFile, readJsonLines, writeJsonFile } from "./storage.mjs";
import { loadWhitelistAccounts } from "./whitelist-accounts.mjs";
import { isCanonicalTikTokVideoUrl } from "./video-time.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_WHITELIST_CONFIG_PATH = path.join("monitoring_data", "base_dashboard_whitelist_config.json");
const MANUAL_SYNC_STATE_PATH = path.join("monitoring_data", "state", "manual_base_sync_state.json");
const LIKE_SOURCE_FIELD = "来源品表";
const INCREMENT_PRODUCT_FIELD = "商品";
const LEGACY_INCREMENT_PRODUCT_FIELD = "产品名";
const LEGACY_INCREMENT_BUCKET_FIELD = "增量档位";
const INCREMENT_RECORD_TYPE_FIELD = "记录类型";
const INCREMENT_RECORD_TYPE_LATEST = "最新";
const INCREMENT_RECORD_TYPE_HISTORY = "历史";
const INCREMENT_HOURS_FIELD = "间隔小时";
const INCREMENT_VIEWS_DELTA_FIELD = "播放增量";
const INCREMENT_VIEWS_PER_HOUR_FIELD = "每小时播放增量";
const INCREMENT_SUMMARY_FIELD = "起量数据";
const LEGACY_INCREMENT_SUMMARY_FIELD = "增量说明";
const MIN_INCREMENT_VIEWS_DELTA = 1000;
const DEFAULT_TABLE_NAMES = {
  archive: "汇总视频（数据存档）",
  likes: "视频榜（点赞>2k）",
  increments: "视频增量榜"
};

export async function syncWhitelistManualBaseTables({
  dataDir = "monitoring_data",
  baseToken,
  tableNames = DEFAULT_TABLE_NAMES,
  whitelistAccounts,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  const resolvedBaseToken = baseToken ?? (await readJsonFile(DEFAULT_WHITELIST_CONFIG_PATH, {})).baseToken;
  if (!resolvedBaseToken) {
    throw new Error("baseToken is required");
  }

  const resolvedWhitelistAccounts = whitelistAccounts ?? await loadWhitelistAccounts({ dataDir, baseToken: resolvedBaseToken });
  const dashboardRecords = await buildBaseDashboardRecords({
    dataDir,
    whitelistAccounts: resolvedWhitelistAccounts
  });
  const skippedLikes = await buildSkippedLikeRows({
    dataDir,
    whitelistAccounts: resolvedWhitelistAccounts
  });
  const manualSyncState = await readJsonFile(MANUAL_SYNC_STATE_PATH, null);
  const accountProductLookup = buildAccountProductLookup(resolvedWhitelistAccounts);
  const manualRows = buildWhitelistManualTableRows({
    dashboardRecords,
    skippedLikes,
    suppressIncrements: !manualSyncState?.hasBaseline || manualSyncState?.baseToken !== resolvedBaseToken,
    accountProductLookup
  });
  const tables = await listBaseTables({ baseToken: resolvedBaseToken, larkCliPath, execFileImpl, platform });
  const tableByName = new Map(tables.map((table) => [String(table.name ?? "").trim(), table.id]));
  const tableMap = {
    archive: tableByName.get(tableNames.archive),
    likes: tableByName.get(tableNames.likes),
    increments: tableByName.get(tableNames.increments)
  };

  for (const [kind, tableId] of Object.entries(tableMap)) {
    if (!tableId) {
      throw new Error(`table not found: ${tableNames[kind]}`);
    }
  }

  await ensureManualResultTableFields({
    baseToken: resolvedBaseToken,
    tableMap,
    larkCliPath,
    execFileImpl,
    platform
  });
  await ensureManualResultViews({
    baseToken: resolvedBaseToken,
    tableMap,
    larkCliPath,
    execFileImpl,
    platform
  });

  const cleared = {
    archive: 0,
    likes: 0,
    increments: 0
  };
  const inserted = {};
  inserted.archive = await syncArchiveRows({
    baseToken: resolvedBaseToken,
    tableId: tableMap.archive,
    rows: manualRows.archive,
    larkCliPath,
    execFileImpl,
    platform
  });

  await dedupeLikesRows({
    baseToken: resolvedBaseToken,
    tableId: tableMap.likes,
    rows: manualRows.likes,
    larkCliPath,
    execFileImpl,
    platform
  });

  inserted.likes = await appendMissingRows({
    baseToken: resolvedBaseToken,
    tableId: tableMap.likes,
    rows: manualRows.likes,
    signatureFn: buildLikesRowSignature,
    larkCliPath,
    execFileImpl,
    platform
  });
  inserted.increments = await syncIncrementRows({
    baseToken: resolvedBaseToken,
    tableId: tableMap.increments,
    rows: manualRows.increments,
    videoSourceLookup: buildVideoSourceLookup(dashboardRecords?.videos ?? [], accountProductLookup),
    accountSourceLookup: buildAccountSourceLookup({
      videos: dashboardRecords?.videos ?? [],
      whitelistAccounts: resolvedWhitelistAccounts
    }),
    larkCliPath,
    execFileImpl,
    platform
  });

  await writeJsonFile(MANUAL_SYNC_STATE_PATH, {
    baseToken: resolvedBaseToken,
    hasBaseline: true,
    syncedAt: new Date().toISOString(),
    counts: {
      archive: manualRows.archive.length,
      likes: manualRows.likes.length,
      increments: manualRows.increments.length
    }
  });

  return {
    baseToken: resolvedBaseToken,
    tableMap,
    cleared,
    inserted,
    counts: {
      whitelistRows: resolvedWhitelistAccounts.length,
      archive: manualRows.archive.length,
      likes: manualRows.likes.length,
      increments: manualRows.increments.length,
      skippedLikes: skippedLikes.length
    }
  };
}

export function buildWhitelistManualTableRows({ dashboardRecords, skippedLikes = [], suppressIncrements = false, accountProductLookup = new Map() } = {}) {
  const videos = dashboardRecords?.videos ?? [];
  const normalizedVideos = videos
    .map((row) => normalizeDashboardVideoRow(row, accountProductLookup))
    .filter(Boolean)
    .sort((left, right) => {
      if (String(right.publishedAt ?? "") !== String(left.publishedAt ?? "")) {
        return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
      }
      return String(left.account ?? "").localeCompare(String(right.account ?? ""));
    });

  const archive = normalizedVideos.map((video) => ({
      "账号": video.account,
      "视频链接": video.videoUrl,
      "发布时间": video.publishedAt,
      "更新时间": video.updatedAt,
      "播放量": video.views,
      "点赞量": video.likes,
      "评论数": video.comments,
    "转发数": video.shares
  }));

  const likes = normalizedVideos
    .filter((video) => Number(video.likes ?? 0) >= 2000)
    .sort((left, right) => {
      if (Number(right.likes ?? 0) !== Number(left.likes ?? 0)) {
        return Number(right.likes ?? 0) - Number(left.likes ?? 0);
      }
      if (Number(right.shares ?? 0) !== Number(left.shares ?? 0)) {
        return Number(right.shares ?? 0) - Number(left.shares ?? 0);
      }
      return String(right.publishedAt ?? "").localeCompare(String(left.publishedAt ?? ""));
    })
    .map((video) => ({
      "账号": video.account,
      "视频链接": video.videoUrl,
      "发布时间": video.publishedAt,
      [LIKE_SOURCE_FIELD]: video.sourceTable,
      "播放量": video.views,
      "点赞量": video.likes,
      "评论数": video.comments,
      "转发数": video.shares
    }))
    .concat(skippedLikes);

  const dedupedLikes = dedupeRowsBySignature(likes, buildLikesRowSignature, compareLikesMetrics);

  const increments = suppressIncrements
    ? []
    : normalizedVideos
    .map((video) => {
      const incrementBuckets = classifyIncrementWindows(video);
      if (incrementBuckets.length === 0) return undefined;
      return {
        ...video,
        incrementBuckets
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (Number(right.viewsDelta ?? 0) !== Number(left.viewsDelta ?? 0)) {
        return Number(right.viewsDelta ?? 0) - Number(left.viewsDelta ?? 0);
      }
      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    })
    .map((video) => ({
      "账号": video.account,
      "视频链接": video.videoUrl,
      "发布时间": video.publishedAt,
      "更新时间": video.updatedAt,
      "上次更新时间": video.previousUpdatedAt,
      [INCREMENT_RECORD_TYPE_FIELD]: INCREMENT_RECORD_TYPE_LATEST,
      [INCREMENT_PRODUCT_FIELD]: video.incrementBuckets.join("｜"),
      [INCREMENT_HOURS_FIELD]: calculateIncrementHours(video),
      [INCREMENT_VIEWS_DELTA_FIELD]: video.viewsDelta,
      [INCREMENT_VIEWS_PER_HOUR_FIELD]: calculateViewsPerHour(video),
      [INCREMENT_SUMMARY_FIELD]: buildIncrementSummary(video),
      "播放量": video.views,
      "点赞量": video.likes,
      "评论数": video.comments,
      "转发数": video.shares
    }));

  return { archive, likes: dedupedLikes, increments };
}

export function classifyIncrementWindow(video) {
  return classifyIncrementWindows(video)[0] ?? "";
}

export function classifyIncrementWindows(video) {
  const previousUpdatedAt = String(video?.previousUpdatedAt ?? "").trim();
  const updatedAt = String(video?.updatedAt ?? "").trim();
  if (!previousUpdatedAt || !updatedAt) return [];
  const previousTime = new Date(previousUpdatedAt).getTime();
  const currentTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return [];
  const viewsDelta = Number(video?.viewsDelta ?? 0);
  if (viewsDelta < MIN_INCREMENT_VIEWS_DELTA) return [];
  return [buildIncrementHeadline(video)];
}

function calculateIncrementHours(video) {
  const previousUpdatedAt = String(video?.previousUpdatedAt ?? "").trim();
  const updatedAt = String(video?.updatedAt ?? "").trim();
  if (!previousUpdatedAt || !updatedAt) return 0;
  const previousTime = new Date(previousUpdatedAt).getTime();
  const currentTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return 0;
  const hours = (currentTime - previousTime) / 3_600_000;
  return Math.max(0, Math.round(hours * 10) / 10);
}

function buildIncrementSummary(video) {
  const hours = calculateIncrementHours(video);
  const viewsDelta = toNumber(video?.viewsDelta);
  const likesDelta = toNumber(video?.likesDelta);
  const commentsDelta = toNumber(video?.commentsDelta);
  const sharesDelta = toNumber(video?.sharesDelta);
  return `近${formatHoursLabel(hours)}个小时，新增${viewsDelta}播放，点赞+${likesDelta}，评论+${commentsDelta}，转发+${sharesDelta}`;
}

function calculateViewsPerHour(video) {
  const hours = calculateIncrementHours(video);
  const viewsDelta = toNumber(video?.viewsDelta);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round((viewsDelta / hours) * 100) / 100;
}

function calculateViewsPerHourFromRow(row = {}) {
  const hours = toNumber(row?.[INCREMENT_HOURS_FIELD]);
  const viewsDelta = toNumber(row?.[INCREMENT_VIEWS_DELTA_FIELD]);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round((viewsDelta / hours) * 100) / 100;
}

function buildIncrementHeadline(video, hours = calculateIncrementHours(video)) {
  return resolveProductLabel({
    sourceTable: video?.sourceTable,
    materialType: video?.materialType,
    productName: video?.productName
  });
}

function formatHoursLabel(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "0";
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(1).replace(/\.0$/u, "");
}

function normalizeDashboardVideoRow(row, accountProductLookup = new Map()) {
  const fields = row?.fields ?? {};
  const videoUrl = extractRawUrl(fields["视频链接"]);
  if (!videoUrl) return undefined;
  const accountName = String(fields["账号名"] ?? fields["账号"] ?? "").trim();
  const sourceTable = String(fields["来源表"] ?? "").trim();
  const materialType = String(fields["素材类型"] ?? "").trim();
  const productName = String(accountProductLookup.get(accountName) ?? "").trim();
  return {
    account: accountName,
    sourceTable,
    materialType,
    productName,
    productLabel: resolveProductLabel({ sourceTable, materialType, productName }),
    videoUrl,
    publishedAt: normalizeDatetime(fields["发布时间"]),
    updatedAt: normalizeDatetime(fields["更新时间"]),
    previousUpdatedAt: normalizeDatetime(fields["上次更新时间"]),
    views: toNumber(fields["当前播放"] ?? fields["播放"]),
    likes: toNumber(fields["当前点赞"] ?? fields["点赞"]),
    comments: toNumber(fields["当前评论"] ?? fields["评论"]),
    shares: toNumber(fields["当前转发"] ?? fields["分享"]),
    viewsDelta: toNumber(fields["播放增量"] ?? fields["24h播放增量"]),
    likesDelta: toNumber(fields["点赞增量"] ?? fields["24h点赞增量"]),
    commentsDelta: toNumber(fields["评论增量"] ?? fields["24h评论增量"]),
    sharesDelta: toNumber(fields["转发增量"] ?? fields["24h转发增量"])
  };
}

function buildVideoSourceLookup(rows = [], accountProductLookup = new Map()) {
  const lookup = new Map();
  for (const row of rows) {
    const normalized = normalizeDashboardVideoRow(row, accountProductLookup);
    if (!normalized?.videoUrl) continue;
    lookup.set(normalized.videoUrl, normalized);
  }
  return lookup;
}

function buildAccountProductLookup(whitelistAccounts = []) {
  const lookup = new Map();
  for (const account of whitelistAccounts) {
    const accountName = String(account?.accountName ?? "").trim();
    const productLabel = resolveProductLabel({
      sourceTable: account?.sourceTable,
      materialType: account?.materialType,
      productName: account?.productName
    });
    if (!accountName || !productLabel) continue;
    if (!lookup.has(accountName)) {
      lookup.set(accountName, productLabel);
    }
  }
  return lookup;
}

function buildAccountSourceLookup({ videos = [], whitelistAccounts = [] } = {}) {
  const lookup = new Map();
  for (const row of videos) {
    const normalized = normalizeDashboardVideoRow(row);
    if (!normalized?.account || !normalized?.sourceTable) continue;
    lookup.set(String(normalized.account).trim(), resolveProductLabel(normalized));
  }
  for (const account of whitelistAccounts) {
    const accountName = String(account?.accountName ?? "").trim();
    const productLabel = resolveProductLabel({
      sourceTable: account?.sourceTable,
      materialType: account?.materialType,
      productName: account?.productName
    });
    if (!accountName || !productLabel) continue;
    lookup.set(accountName, productLabel);
  }
  return lookup;
}

function resolveProductLabel({ sourceTable = "", materialType = "", productName = "" } = {}) {
  const source = String(sourceTable ?? "").trim();
  const product = String(productName ?? "").trim();
  const material = String(materialType ?? "").trim();
  if (product) {
    return product.split("｜").map((item) => item.trim()).find(Boolean) || source;
  }
  if (source === "其他品" && material) {
    return material.split("｜").map((item) => item.trim()).find(Boolean) || source;
  }
  return source;
}

function extractRawUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const markdownLink = text.match(/\((https?:\/\/[^)]+)\)$/u);
  if (markdownLink) return markdownLink[1];
  return text;
}

function normalizeDatetime(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeDatetimeKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return text;
  const date = new Date(time);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function toNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function listBaseTables({ baseToken, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+table-list", "--base-token", baseToken, "--offset", "0", "--limit", "100"];
  const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  const parsed = JSON.parse(stdout);
  return parsed.data?.tables ?? [];
}

async function ensureManualResultTableFields({ baseToken, tableMap, larkCliPath, execFileImpl, platform }) {
  const likesFields = await listBaseFields({ baseToken, tableId: tableMap.likes, larkCliPath, execFileImpl, platform });
  if (!likesFields.some((field) => field.name === LIKE_SOURCE_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.likes,
      fieldJson: { name: LIKE_SOURCE_FIELD, type: "text" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }

  const incrementFields = await listBaseFields({ baseToken, tableId: tableMap.increments, larkCliPath, execFileImpl, platform });
  await ensureDatetimeFieldFormat({
    baseToken,
    tableId: tableMap.increments,
    fields: incrementFields,
    fieldName: "更新时间",
    format: "yyyy/MM/dd HH:mm",
    larkCliPath,
    execFileImpl,
    platform
  });
  await ensureDatetimeFieldFormat({
    baseToken,
    tableId: tableMap.increments,
    fields: incrementFields,
    fieldName: "上次更新时间",
    format: "yyyy/MM/dd HH:mm",
    larkCliPath,
    execFileImpl,
    platform
  });
  if (!incrementFields.some((field) => field.name === INCREMENT_PRODUCT_FIELD || field.name === LEGACY_INCREMENT_PRODUCT_FIELD || field.name === LEGACY_INCREMENT_BUCKET_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_PRODUCT_FIELD, type: "text" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
  if (!incrementFields.some((field) => field.name === INCREMENT_RECORD_TYPE_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_RECORD_TYPE_FIELD, type: "text" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
  if (!incrementFields.some((field) => field.name === INCREMENT_HOURS_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_HOURS_FIELD, type: "number" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
  if (!incrementFields.some((field) => field.name === INCREMENT_VIEWS_DELTA_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_VIEWS_DELTA_FIELD, type: "number" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
  if (!incrementFields.some((field) => field.name === INCREMENT_VIEWS_PER_HOUR_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_VIEWS_PER_HOUR_FIELD, type: "number" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
  if (!incrementFields.some((field) => field.name === INCREMENT_SUMMARY_FIELD || field.name === LEGACY_INCREMENT_SUMMARY_FIELD)) {
    await createBaseField({
      baseToken,
      tableId: tableMap.increments,
      fieldJson: { name: INCREMENT_SUMMARY_FIELD, type: "text" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }
}

async function ensureManualResultViews({ baseToken, tableMap, larkCliPath, execFileImpl, platform }) {
  await setViewFilter({
    baseToken,
    tableId: tableMap.likes,
    viewId: "People Skills",
    filterJson: { logic: "and", conditions: [[LIKE_SOURCE_FIELD, "==", "People Skills"]] },
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewFilter({
    baseToken,
    tableId: tableMap.likes,
    viewId: "Raise Children",
    filterJson: { logic: "and", conditions: [[LIKE_SOURCE_FIELD, "==", "Raise Children"]] },
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewFilter({
    baseToken,
    tableId: tableMap.likes,
    viewId: "Make More Money",
    filterJson: { logic: "and", conditions: [[LIKE_SOURCE_FIELD, "==", "Make More Money"]] },
    larkCliPath,
    execFileImpl,
    platform
  });

  let incrementViews = await listBaseViews({ baseToken, tableId: tableMap.increments, larkCliPath, execFileImpl, platform });
  let incrementViewByName = new Map(incrementViews.map((view) => [String(view.name ?? "").trim(), view]));
  if (incrementViewByName.has("全部增量") && !incrementViewByName.has("最新起量视频")) {
    await renameBaseView({
      baseToken,
      tableId: tableMap.increments,
      viewId: "全部增量",
      name: "最新起量视频",
      larkCliPath,
      execFileImpl,
      platform
    });
    incrementViews = await listBaseViews({ baseToken, tableId: tableMap.increments, larkCliPath, execFileImpl, platform });
    incrementViewByName = new Map(incrementViews.map((view) => [String(view.name ?? "").trim(), view]));
  }
  if (!incrementViewByName.has("最新起量视频")) {
    await createBaseView({
      baseToken,
      tableId: tableMap.increments,
      viewJson: { name: "最新起量视频", type: "grid" },
      larkCliPath,
      execFileImpl,
      platform
    });
    incrementViews = await listBaseViews({ baseToken, tableId: tableMap.increments, larkCliPath, execFileImpl, platform });
    incrementViewByName = new Map(incrementViews.map((view) => [String(view.name ?? "").trim(), view]));
  }
  if (!incrementViewByName.has("历史起量视频")) {
    await createBaseView({
      baseToken,
      tableId: tableMap.increments,
      viewJson: { name: "历史起量视频", type: "grid" },
      larkCliPath,
      execFileImpl,
      platform
    });
  }

  await setViewFilter({
    baseToken,
    tableId: tableMap.increments,
    viewId: "最新起量视频",
    filterJson: { logic: "and", conditions: [[INCREMENT_RECORD_TYPE_FIELD, "==", INCREMENT_RECORD_TYPE_LATEST]] },
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewVisibleFields({
    baseToken,
    tableId: tableMap.increments,
    viewId: "最新起量视频",
    fieldNames: ["账号", "视频链接", INCREMENT_PRODUCT_FIELD, "发布时间", INCREMENT_SUMMARY_FIELD, "更新时间", "上次更新时间", INCREMENT_VIEWS_DELTA_FIELD, INCREMENT_HOURS_FIELD, INCREMENT_VIEWS_PER_HOUR_FIELD, "播放量", "点赞量", "评论数", "转发数"],
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewSort({
    baseToken,
    tableId: tableMap.increments,
    viewId: "最新起量视频",
    sortFields: [
      { name: INCREMENT_VIEWS_PER_HOUR_FIELD, desc: true },
      { name: INCREMENT_VIEWS_DELTA_FIELD, desc: true },
      { name: "更新时间", desc: true },
    ],
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewFilter({
    baseToken,
    tableId: tableMap.increments,
    viewId: "历史起量视频",
    filterJson: { logic: "and", conditions: [[INCREMENT_RECORD_TYPE_FIELD, "==", INCREMENT_RECORD_TYPE_HISTORY]] },
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewVisibleFields({
    baseToken,
    tableId: tableMap.increments,
    viewId: "历史起量视频",
    fieldNames: ["账号", "视频链接", INCREMENT_PRODUCT_FIELD, "发布时间", INCREMENT_SUMMARY_FIELD, "更新时间", "上次更新时间", INCREMENT_VIEWS_DELTA_FIELD, INCREMENT_HOURS_FIELD, INCREMENT_VIEWS_PER_HOUR_FIELD, "播放量", "点赞量", "评论数", "转发数"],
    larkCliPath,
    execFileImpl,
    platform
  });
  await setViewSort({
    baseToken,
    tableId: tableMap.increments,
    viewId: "历史起量视频",
    sortFields: [
      { name: INCREMENT_VIEWS_PER_HOUR_FIELD, desc: true },
      { name: INCREMENT_VIEWS_DELTA_FIELD, desc: true },
      { name: "更新时间", desc: true },
    ],
    larkCliPath,
    execFileImpl,
    platform
  });
}

async function listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--offset", "0", "--limit", "200"];
  const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  const parsed = JSON.parse(stdout);
  return parsed.data?.fields ?? [];
}

async function createBaseField({ baseToken, tableId, fieldJson, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+field-create", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify(fieldJson)];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function ensureDatetimeFieldFormat({
  baseToken,
  tableId,
  fields = [],
  fieldName,
  format,
  larkCliPath,
  execFileImpl,
  platform
}) {
  const field = fields.find((candidate) => candidate.name === fieldName && candidate.type === "datetime");
  if (!field) return;
  if (String(field.style?.format ?? "").trim() === format) return;
  const fieldJson = {
    name: field.name,
    type: field.type,
    style: {
      ...(field.style ?? {}),
      format
    }
  };
  const args = [
    "base", "+field-update",
    "--base-token", baseToken,
    "--table-id", tableId,
    "--field-id", field.id,
    "--json", JSON.stringify(fieldJson),
    "--yes"
  ];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function createBaseView({ baseToken, tableId, viewJson, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+view-create", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify(viewJson)];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function renameBaseView({ baseToken, tableId, viewId, name, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+view-rename", "--base-token", baseToken, "--table-id", tableId, "--view-id", viewId, "--name", name];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function setViewFilter({ baseToken, tableId, viewId, filterJson, larkCliPath, execFileImpl, platform }) {
  const currentFilter = await getViewFilter({ baseToken, tableId, viewId, larkCliPath, execFileImpl, platform });
  if (filtersEqual(currentFilter, filterJson)) {
    return;
  }
  const args = ["base", "+view-set-filter", "--base-token", baseToken, "--table-id", tableId, "--view-id", viewId, "--json", JSON.stringify(filterJson)];
  try {
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? error ?? "");
    if (/800004135|OpenAPIUpdateViewFilter limited/i.test(message)) {
      const refreshedFilter = await getViewFilter({ baseToken, tableId, viewId, larkCliPath, execFileImpl, platform });
      if (filtersEqual(refreshedFilter, filterJson)) {
        return;
      }
    }
    throw error;
  }
}

async function setViewVisibleFields({ baseToken, tableId, viewId, fieldNames, larkCliPath, execFileImpl, platform }) {
  const fields = await listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const fieldByName = new Map(fields.map((field) => [String(field.name ?? "").trim(), field.id]));
  const visibleFields = fieldNames.map((name) => fieldByName.get(name) ?? name).filter(Boolean);
  const args = [
    "base", "+view-set-visible-fields", "--base-token", baseToken, "--table-id", tableId, "--view-id", viewId,
    "--json", JSON.stringify({ visible_fields: visibleFields })
  ];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function setViewSort({ baseToken, tableId, viewId, sortFields, larkCliPath, execFileImpl, platform }) {
  const fields = await listBaseFields({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const fieldByName = new Map(fields.map((field) => [String(field.name ?? "").trim(), field.id]));
  const sortConfig = sortFields
    .map((field) => {
      const fieldId = fieldByName.get(field.name) ?? field.name;
      if (!fieldId) return undefined;
      return { field: fieldId, desc: field.desc !== false };
    })
    .filter(Boolean);
  const args = [
    "base", "+view-set-sort", "--base-token", baseToken, "--table-id", tableId, "--view-id", viewId,
    "--json", JSON.stringify({ sort_config: sortConfig })
  ];
  await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
}

async function clearTableRecords({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const recordIds = await listAllRecordIds({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  for (const recordId of recordIds) {
    const args = ["base", "+record-delete", "--base-token", baseToken, "--table-id", tableId, "--record-id", recordId, "--yes"];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  }
  return recordIds.length;
}

async function appendMissingRows({ baseToken, tableId, rows, signatureFn, larkCliPath, execFileImpl, platform }) {
  const existingRows = await listTableRows({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const existingSignatures = new Set(
    existingRows
      .map((row) => signatureFn?.(row))
      .filter(Boolean)
  );
  const rowsToInsert = rows.filter((row) => {
    const signature = signatureFn?.(row);
    if (!signature) return true;
    if (existingSignatures.has(signature)) return false;
    existingSignatures.add(signature);
    return true;
  });
  return upsertRows({
    baseToken,
    tableId,
    rows: rowsToInsert,
    larkCliPath,
    execFileImpl,
    platform
  });
}

async function syncIncrementRows({ baseToken, tableId, rows, videoSourceLookup = new Map(), accountSourceLookup = new Map(), larkCliPath, execFileImpl, platform }) {
  const existingRows = await listTableRows({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const { deleteRecordIds, updateRows, rowsToInsert } = planIncrementRowChanges({
    existingRows,
    incomingRows: rows,
    videoSourceLookup,
    accountSourceLookup
  });
  await deleteBaseRecords({
    baseToken,
    tableId,
    recordIds: deleteRecordIds,
    larkCliPath,
    execFileImpl,
    platform
  });
  for (const { recordId, row } of updateRows) {
    const args = ["base", "+record-upsert", "--base-token", baseToken, "--table-id", tableId, "--record-id", recordId, "--json", JSON.stringify(row)];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  }
  return upsertRows({
    baseToken,
    tableId,
    rows: rowsToInsert,
    larkCliPath,
    execFileImpl,
    platform
  });
}

async function upsertRows({ baseToken, tableId, rows, larkCliPath, execFileImpl, platform }) {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const args = ["base", "+record-upsert", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify(rows[index])];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
    inserted += 1;
    if ((index + 1) % 50 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  return inserted;
}

async function listTableRows({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const args = ["base", "+record-list", "--base-token", baseToken, "--table-id", tableId, "--offset", String(offset), "--limit", "200", "--format", "json"];
    const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
    const parsed = parseRecordList(stdout);
    for (let index = 0; index < parsed.data.length; index += 1) {
      rows.push(materializeRecord(parsed.fields, parsed.data[index], parsed.recordIds[index]));
    }
    if (parsed.data.length < 200) break;
  }
  return rows;
}

async function listAllRecordIds({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const recordIds = [];
  for (let offset = 0; ; offset += 200) {
    const args = ["base", "+record-list", "--base-token", baseToken, "--table-id", tableId, "--offset", String(offset), "--limit", "200", "--format", "json"];
    const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
    const parsed = JSON.parse(stdout);
    const ids = parsed.data?.record_id_list ?? [];
    recordIds.push(...ids);
    if (ids.length < 200) break;
  }
  return recordIds;
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

function materializeRecord(fields = [], row = [], recordId = "") {
  const record = {};
  for (let index = 0; index < fields.length; index += 1) {
    record[String(fields[index] ?? "").trim()] = normalizeBaseCell(row[index]);
  }
  record.__recordId = String(recordId ?? "").trim();
  return record;
}

function normalizeBaseCell(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return normalizeBaseCell(value[0]);
  if (typeof value === "object") {
    return normalizeBaseCell(value.text ?? value.link ?? value.url ?? value.name ?? "");
  }
  const text = String(value).trim();
  const markdownLink = text.match(/^\[[^\]]*\]\(([^)]+)\)$/u);
  return markdownLink ? markdownLink[1] : text;
}

function buildArchiveRowSignature(row = {}) {
  return [
    normalizeBaseCell(row["账号"]),
    normalizeBaseCell(row["视频链接"]),
    normalizeDatetimeKey(row["发布时间"])
  ].join("||");
}

function buildArchiveLogicalKey(row = {}) {
  return buildArchiveRowSignature(row);
}

function buildLikesRowSignature(row = {}) {
  return normalizeBaseCell(row["视频链接"]);
}

function buildLikesLogicalKey(row = {}) {
  return buildLikesRowSignature(row);
}

function buildIncrementRowSignature(row = {}) {
  return [
    String(row["视频链接"] ?? "").trim(),
    String(row[INCREMENT_RECORD_TYPE_FIELD] ?? "").trim(),
    normalizeDatetimeKey(row["更新时间"])
  ].join("||");
}

function buildIncrementLogicalKey(row = {}) {
  return String(row["视频链接"] ?? "").trim();
}

function compareRowUpdatedAt(left = {}, right = {}) {
  return compareIsoDatetime(left["更新时间"], right["更新时间"])
    || compareIsoDatetime(left["上次更新时间"], right["上次更新时间"]);
}

function compareIsoDatetime(leftValue, rightValue) {
  const leftTime = new Date(String(leftValue ?? "").trim()).getTime();
  const rightTime = new Date(String(rightValue ?? "").trim()).getTime();
  const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
  if (safeLeft === safeRight) return 0;
  return safeLeft > safeRight ? 1 : -1;
}

function readIncrementProductCell(row = {}) {
  return String(row[INCREMENT_PRODUCT_FIELD] ?? row[LEGACY_INCREMENT_PRODUCT_FIELD] ?? row[LEGACY_INCREMENT_BUCKET_FIELD] ?? "").trim();
}

function readIncrementSummaryCell(row = {}) {
  return String(row[INCREMENT_SUMMARY_FIELD] ?? row[LEGACY_INCREMENT_SUMMARY_FIELD] ?? "").trim();
}

function readIncrementRecordTypeCell(row = {}) {
  const value = String(row[INCREMENT_RECORD_TYPE_FIELD] ?? "").trim();
  if (value === INCREMENT_RECORD_TYPE_HISTORY) return INCREMENT_RECORD_TYPE_HISTORY;
  return INCREMENT_RECORD_TYPE_LATEST;
}

function normalizeIncrementSummaryText(summary = "") {
  const text = String(summary ?? "").trim();
  if (!text) return "";
  return text
    .replace(/^[^｜]+｜/u, "")
    .replace(/^距上次更新(\d+(?:\.\d+)?)小时，新增/u, "近$1个小时，新增")
    .replace(/^近(\d+(?:\.\d+)?)小时内新增/u, "近$1个小时，新增")
    .replace(/^近(\d+(?:\.\d+)?)小时，新增/u, "近$1个小时，新增");
}

function buildIncrementMigrationRow(row = {}, videoSourceLookup = new Map(), accountSourceLookup = new Map(), recordType = readIncrementRecordTypeCell(row)) {
  const videoUrl = String(row["视频链接"] ?? "").trim();
  const video = videoSourceLookup.get(videoUrl);
  const accountName = String(row["账号"] ?? "").trim();
  const sourceTable = String(video?.productLabel ?? accountSourceLookup.get(accountName) ?? "").trim();
  const currentProduct = readIncrementProductCell(row);
  const nextProduct = sourceTable || currentProduct;
  const currentSummary = readIncrementSummaryCell(row);
  const nextSummary = normalizeIncrementSummaryText(currentSummary);
  const currentViewsPerHour = toNumber(row?.[INCREMENT_VIEWS_PER_HOUR_FIELD]);
  const nextViewsPerHour = calculateViewsPerHourFromRow(row);
  const nextRow = {
    ...omitLegacyIncrementFields(row),
    [INCREMENT_RECORD_TYPE_FIELD]: recordType,
    [INCREMENT_PRODUCT_FIELD]: nextProduct,
    [INCREMENT_VIEWS_PER_HOUR_FIELD]: nextViewsPerHour,
    [INCREMENT_SUMMARY_FIELD]: nextSummary
  };
  return {
    changed:
      recordType !== readIncrementRecordTypeCell(row)
      || nextRow[INCREMENT_RECORD_TYPE_FIELD] !== String(row[INCREMENT_RECORD_TYPE_FIELD] ?? "").trim()
      || nextProduct !== currentProduct
      || nextViewsPerHour !== currentViewsPerHour
      || nextSummary !== currentSummary,
    row: nextRow
  };
}

export function planIncrementRowChanges({
  existingRows = [],
  incomingRows = [],
  videoSourceLookup = new Map(),
  accountSourceLookup = new Map()
} = {}) {
  const deleteRecordIds = [];
  const updateRows = [];
  const rowsToInsert = [];
  const trackedFields = [
    "账号",
    "视频链接",
    "发布时间",
    "更新时间",
    "上次更新时间",
    INCREMENT_RECORD_TYPE_FIELD,
    INCREMENT_PRODUCT_FIELD,
    INCREMENT_HOURS_FIELD,
    INCREMENT_VIEWS_DELTA_FIELD,
    INCREMENT_VIEWS_PER_HOUR_FIELD,
    INCREMENT_SUMMARY_FIELD,
    "播放量",
    "点赞量",
    "评论数",
    "转发数"
  ];

  const incomingByKey = new Map();
  for (const row of incomingRows) {
    const key = buildIncrementLogicalKey(row);
    if (!key) continue;
    const normalized = {
      ...row,
      [INCREMENT_RECORD_TYPE_FIELD]: INCREMENT_RECORD_TYPE_LATEST
    };
    const existing = incomingByKey.get(key);
    if (!existing || compareRowUpdatedAt(normalized, existing) > 0) {
      incomingByKey.set(key, normalized);
    }
  }

  const existingByKey = new Map();
  for (const row of existingRows) {
    const key = buildIncrementLogicalKey(row);
    if (!key) continue;
    if (!existingByKey.has(key)) {
      existingByKey.set(key, []);
    }
    existingByKey.get(key).push(row);
  }

  const allKeys = new Set([...existingByKey.keys(), ...incomingByKey.keys()]);

  for (const key of allKeys) {
    const existingGroup = [...(existingByKey.get(key) ?? [])].sort((left, right) => compareRowUpdatedAt(right, left));
    const incoming = incomingByKey.get(key);
    const existingLatest = existingGroup[0];
    const existingHistory = existingGroup[1];
    const extraExisting = existingGroup.slice(2);

    for (const row of extraExisting) {
      if (String(row.__recordId ?? "").trim()) {
        deleteRecordIds.push(String(row.__recordId).trim());
      }
    }

    if (!existingLatest) {
      if (incoming) {
        rowsToInsert.push(incoming);
      }
      continue;
    }

    if (!incoming) {
      const latestRow = buildIncrementMigrationRow(
        existingLatest,
        videoSourceLookup,
        accountSourceLookup,
        INCREMENT_RECORD_TYPE_LATEST
      ).row;
      if (rowNeedsUpdate(existingLatest, latestRow, trackedFields)) {
        updateRows.push({
          recordId: String(existingLatest.__recordId ?? "").trim(),
          row: latestRow
        });
      }
      if (existingHistory) {
        const historyRow = buildIncrementMigrationRow(
          existingHistory,
          videoSourceLookup,
          accountSourceLookup,
          INCREMENT_RECORD_TYPE_HISTORY
        ).row;
        if (rowNeedsUpdate(existingHistory, historyRow, trackedFields)) {
          updateRows.push({
            recordId: String(existingHistory.__recordId ?? "").trim(),
            row: historyRow
          });
        }
      }
      continue;
    }

    const comparison = compareRowUpdatedAt(incoming, existingLatest);
    if (comparison > 0) {
      if (existingHistory && String(existingHistory.__recordId ?? "").trim()) {
        deleteRecordIds.push(String(existingHistory.__recordId).trim());
      }
      const demotedLatest = buildIncrementMigrationRow(
        existingLatest,
        videoSourceLookup,
        accountSourceLookup,
        INCREMENT_RECORD_TYPE_HISTORY
      ).row;
      updateRows.push({
        recordId: String(existingLatest.__recordId ?? "").trim(),
        row: demotedLatest
      });
      rowsToInsert.push(incoming);
      continue;
    }

    const keptLatest = buildIncrementMigrationRow(
      existingLatest,
      videoSourceLookup,
      accountSourceLookup,
      INCREMENT_RECORD_TYPE_LATEST
    ).row;
    if (comparison === 0 && rowNeedsUpdate(existingLatest, incoming, trackedFields)) {
      updateRows.push({
        recordId: String(existingLatest.__recordId ?? "").trim(),
        row: incoming
      });
    } else if (rowNeedsUpdate(existingLatest, keptLatest, trackedFields)) {
      updateRows.push({
        recordId: String(existingLatest.__recordId ?? "").trim(),
        row: keptLatest
      });
    }

    if (existingHistory) {
      const keptHistory = buildIncrementMigrationRow(
        existingHistory,
        videoSourceLookup,
        accountSourceLookup,
        INCREMENT_RECORD_TYPE_HISTORY
      ).row;
      if (rowNeedsUpdate(existingHistory, keptHistory, trackedFields)) {
        updateRows.push({
          recordId: String(existingHistory.__recordId ?? "").trim(),
          row: keptHistory
        });
      }
    }
  }

  return {
    deleteRecordIds: [...new Set(deleteRecordIds.filter(Boolean))],
    updateRows,
    rowsToInsert
  };
}

function omitLegacyIncrementFields(row = {}) {
  const nextRow = { ...row };
  delete nextRow.__recordId;
  delete nextRow[LEGACY_INCREMENT_PRODUCT_FIELD];
  delete nextRow[LEGACY_INCREMENT_BUCKET_FIELD];
  delete nextRow[LEGACY_INCREMENT_SUMMARY_FIELD];
  return nextRow;
}

function compareLikesMetrics(left = {}, right = {}) {
  const comparisons = [
    toNumber(left["点赞量"]) - toNumber(right["点赞量"]),
    toNumber(left["播放量"]) - toNumber(right["播放量"]),
    toNumber(left["转发数"]) - toNumber(right["转发数"]),
    toNumber(left["评论数"]) - toNumber(right["评论数"]),
    compareIsoDatetime(left["更新时间"], right["更新时间"])
  ];
  for (const comparison of comparisons) {
    if (comparison > 0) return 1;
    if (comparison < 0) return -1;
  }
  return 0;
}

function rowNeedsUpdate(existingRow = {}, incomingRow = {}, fields = []) {
  return fields.some((field) => normalizeBaseCell(existingRow[field]) !== normalizeBaseCell(incomingRow[field]));
}

function dedupeRowsBySignature(rows = [], signatureFn, compareFn = () => 0) {
  const bestBySignature = new Map();
  for (const row of rows) {
    const signature = signatureFn?.(row);
    if (!signature) continue;
    const existing = bestBySignature.get(signature);
    if (!existing || compareFn(row, existing) > 0) {
      bestBySignature.set(signature, row);
    }
  }
  return [...bestBySignature.values()];
}

export function planArchiveRowChanges({ existingRows = [], incomingRows = [] } = {}) {
  const deleteRecordIds = [];
  const updateRows = [];
  const rowsToInsert = [];
  const incomingByKey = new Map(
    incomingRows
      .map((row) => [buildArchiveLogicalKey(row), row])
      .filter(([key]) => key.replace(/\|/gu, "").trim())
  );
  const survivorByKey = new Map();

  for (const row of existingRows) {
    const key = buildArchiveLogicalKey(row);
    if (!key.replace(/\|/gu, "").trim()) continue;
    const currentSurvivor = survivorByKey.get(key);
    if (!currentSurvivor) {
      survivorByKey.set(key, row);
      continue;
    }
    if (compareLikesMetrics(row, currentSurvivor) > 0) {
      if (String(currentSurvivor.__recordId ?? "").trim()) {
        deleteRecordIds.push(String(currentSurvivor.__recordId).trim());
      }
      survivorByKey.set(key, row);
      continue;
    }
    if (String(row.__recordId ?? "").trim()) {
      deleteRecordIds.push(String(row.__recordId).trim());
    }
  }

  const trackedFields = ["账号", "视频链接", "发布时间", "更新时间", "播放量", "点赞量", "评论数", "转发数"];
  for (const [key, incoming] of incomingByKey.entries()) {
    const survivor = survivorByKey.get(key);
    if (!survivor) {
      rowsToInsert.push(incoming);
      continue;
    }
    if (!String(survivor.__recordId ?? "").trim()) {
      rowsToInsert.push(incoming);
      continue;
    }
    if (!rowNeedsUpdate(survivor, incoming, trackedFields)) continue;
    updateRows.push({
      recordId: String(survivor.__recordId).trim(),
      row: incoming
    });
  }

  return {
    deleteRecordIds: [...new Set(deleteRecordIds.filter(Boolean))],
    updateRows,
    rowsToInsert
  };
}

export function planLikesRowChanges({ existingRows = [], incomingRows = [] } = {}) {
  const deleteRecordIds = [];
  const updateRows = [];
  const incomingByKey = new Map(
    incomingRows
      .map((row) => [buildLikesLogicalKey(row), row])
      .filter(([key]) => key.replace(/\|/gu, "").trim())
  );
  const survivorByKey = new Map();

  for (const row of existingRows) {
    const key = buildLikesLogicalKey(row);
    if (!key.replace(/\|/gu, "").trim()) continue;
    const currentSurvivor = survivorByKey.get(key);
    if (!currentSurvivor) {
      survivorByKey.set(key, row);
      continue;
    }
    if (compareLikesMetrics(row, currentSurvivor) > 0) {
      if (String(currentSurvivor.__recordId ?? "").trim()) {
        deleteRecordIds.push(String(currentSurvivor.__recordId).trim());
      }
      survivorByKey.set(key, row);
      continue;
    }
    if (String(row.__recordId ?? "").trim()) {
      deleteRecordIds.push(String(row.__recordId).trim());
    }
  }

  const trackedFields = ["账号", "来源品表", "视频链接", "发布时间", "播放量", "点赞量", "评论数", "转发数"];
  for (const [key, survivor] of survivorByKey.entries()) {
    const incoming = incomingByKey.get(key);
    if (!incoming) continue;
    if (!String(survivor.__recordId ?? "").trim()) continue;
    if (!rowNeedsUpdate(survivor, incoming, trackedFields)) continue;
    updateRows.push({
      recordId: String(survivor.__recordId).trim(),
      row: incoming
    });
  }

  return {
    deleteRecordIds: [...new Set(deleteRecordIds.filter(Boolean))],
    updateRows
  };
}

async function listBaseViews({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+view-list", "--base-token", baseToken, "--table-id", tableId];
  const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  const parsed = JSON.parse(stdout);
  return parsed.data?.views ?? [];
}

async function getViewFilter({ baseToken, tableId, viewId, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+view-get-filter", "--base-token", baseToken, "--table-id", tableId, "--view-id", viewId];
  const { stdout } = await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  const parsed = JSON.parse(stdout);
  return parsed.data?.filter ?? null;
}

function filtersEqual(left, right) {
  return JSON.stringify(normalizeFilter(left)) === JSON.stringify(normalizeFilter(right));
}

function normalizeFilter(value) {
  if (!value) return null;
  const logic = String(value.logic ?? "and").toLowerCase();
  const conditions = Array.isArray(value.conditions)
    ? value.conditions.map((condition) => Array.isArray(condition) ? [...condition] : condition)
    : [];
  return { logic, conditions };
}

async function countTableRecords({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const recordIds = await listAllRecordIds({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  return recordIds.length;
}

async function dedupeLikesRows({ baseToken, tableId, rows, larkCliPath, execFileImpl, platform }) {
  const existingRows = await listTableRows({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const { deleteRecordIds, updateRows } = planLikesRowChanges({
    existingRows,
    incomingRows: rows
  });

  await deleteBaseRecords({
    baseToken,
    tableId,
    recordIds: deleteRecordIds,
    larkCliPath,
    execFileImpl,
    platform
  });

  for (const { recordId, row } of updateRows) {
    const args = ["base", "+record-upsert", "--base-token", baseToken, "--table-id", tableId, "--record-id", recordId, "--json", JSON.stringify(row)];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  }

  return {
    deleted: deleteRecordIds.length,
    updated: updateRows.length
  };
}

async function syncArchiveRows({ baseToken, tableId, rows, larkCliPath, execFileImpl, platform }) {
  const existingRows = await listTableRows({ baseToken, tableId, larkCliPath, execFileImpl, platform });
  const { deleteRecordIds, updateRows, rowsToInsert } = planArchiveRowChanges({
    existingRows,
    incomingRows: rows
  });

  await deleteBaseRecords({
    baseToken,
    tableId,
    recordIds: deleteRecordIds,
    larkCliPath,
    execFileImpl,
    platform
  });

  for (const { recordId, row } of updateRows) {
    const args = ["base", "+record-upsert", "--base-token", baseToken, "--table-id", tableId, "--record-id", recordId, "--json", JSON.stringify(row)];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  }

  return upsertRows({
    baseToken,
    tableId,
    rows: rowsToInsert,
    larkCliPath,
    execFileImpl,
    platform
  });
}

async function buildSkippedLikeRows({ dataDir = "monitoring_data", whitelistAccounts = [] } = {}) {
  const skippedAccounts = whitelistAccounts.filter((account) => account.skipTracking === true);
  if (skippedAccounts.length === 0) return [];
  const snapshots = (await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl")))
    .filter((snapshot) => isCanonicalTikTokVideoUrl(snapshot?.videoUrl ?? ""));
  const latestSnapshots = latestSnapshotsByVideo(snapshots);
  const now = Date.now();
  const rows = [];

  for (const account of skippedAccounts) {
    for (const snapshot of latestSnapshots) {
      if (String(snapshot.accountHandle ?? "").trim() !== String(account.handle ?? "").trim()) continue;
      const postedAt = normalizeDatetime(snapshot.postedAt);
      if (!isWithinNinetyDays(postedAt, now)) continue;
      const likes = toNumber(snapshot.likes);
      if (likes < 2000) continue;
      rows.push({
        "账号": account.accountName || account.handle,
        "视频链接": String(snapshot.videoUrl ?? "").trim(),
        "发布时间": postedAt,
        [LIKE_SOURCE_FIELD]: account.sourceTable ?? "",
        "播放量": toNumber(snapshot.views),
        "点赞量": likes,
        "评论数": toNumber(snapshot.comments),
        "转发数": toNumber(snapshot.shares)
      });
    }
  }

  return rows;
}

function latestSnapshotsByVideo(snapshots = []) {
  const latestByVideo = new Map();
  for (const snapshot of snapshots) {
    const videoUrl = String(snapshot?.videoUrl ?? "").trim();
    if (!videoUrl) continue;
    const existing = latestByVideo.get(videoUrl);
    if (!existing || String(snapshot.collectedAt ?? "") > String(existing.collectedAt ?? "")) {
      latestByVideo.set(videoUrl, snapshot);
    }
  }
  return [...latestByVideo.values()];
}

function isWithinNinetyDays(value, nowMs = Date.now()) {
  const time = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(time)) return false;
  return nowMs - time <= 90 * 24 * 3_600_000;
}

async function execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args, retries = 5 }) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
      return await execFileImpl(invocation.command, invocation.args, {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      });
    } catch (error) {
      lastError = error;
      const message = String(error?.stderr ?? error?.message ?? error ?? "");
      if (!/EOF|timed out|time out|timeout|ECONNRESET|socket hang up|Temporary failure/i.test(message) || attempt === retries - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function deleteBaseRecords({ baseToken, tableId, recordIds = [], larkCliPath, execFileImpl, platform, chunkSize = 100 }) {
  const normalizedRecordIds = [...new Set(recordIds.map((recordId) => String(recordId ?? "").trim()).filter(Boolean))];
  for (let index = 0; index < normalizedRecordIds.length; index += chunkSize) {
    const chunk = normalizedRecordIds.slice(index, index + chunkSize);
    const args = [
      "base", "+record-delete",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--json", JSON.stringify({ record_id_list: chunk }),
      "--yes"
    ];
    await execLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  }
}
