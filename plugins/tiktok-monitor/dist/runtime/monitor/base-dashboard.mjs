import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { readJsonFile, readJsonLines, writeJsonFile } from "./storage.mjs";
import { buildLarkCliInvocation } from "./alerts.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_DASHBOARD_CONFIG_PATH = path.join("monitoring_data", "base_dashboard_config.json");

export async function buildBaseDashboardRecords({ dataDir = "monitoring_data" } = {}) {
  const accounts = await readJsonFile(path.join(dataDir, "seeds", "accounts.json"), []);
  const accountCandidates = await readJsonFile(path.join(dataDir, "seeds", "account_candidates.json"), []);
  const videoSnapshots = await readJsonLines(path.join(dataDir, "snapshots", "video_snapshots.jsonl"));
  const videos = latestBy(videoSnapshots, (item) => item.videoUrl);
  const videoCountsByAccount = countVideosByAccount(videoSnapshots);
  const signals = await readJsonLines(path.join(dataDir, "signals", "signals.jsonl"));
  const products = latestBy(await readJsonLines(path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl")), (item) => item.productUrl);
  const accountRows = mergeAccountsAndCandidates({ accounts, accountCandidates });

  return {
    accounts: accountRows.map((account) => ({
      key: account.handle,
      fields: {
        "账号": account.handle,
        "主页": account.profileUrl,
        "来源关键词": account.sourceQuery ?? "",
        "关联书": (account.relatedBooks ?? []).join(", "),
        "是否带货": Boolean(account.hasCommerce),
        "状态": account.status ?? (account.enabled === false ? "停用" : "跟踪中"),
        "最近采集时间": formatFeishuDatetime(account.lastDiscoveredAt ?? account.lastCollectedAt),
        "最近视频数": Number(account.recentVideoCount ?? videoCountsByAccount.get(account.handle) ?? 0)
      }
    })),
    videos: videos.map((video) => ({
      key: video.videoUrl,
      fields: {
        "视频链接": video.videoUrl,
        "账号": video.accountHandle ?? "",
        "采集时间": formatFeishuDatetime(video.collectedAt),
        "播放": Number(video.views ?? 0),
        "点赞": Number(video.likes ?? 0),
        "评论": Number(video.comments ?? 0),
        "分享": Number(video.shares ?? 0),
        "商品链接": stringifyProductRefs(video.productRefs)
      }
    })),
    signals: signals.map((signal) => ({
      key: `${signal.entityUrl}-${signal.detectedAt ?? signal.windowHours ?? ""}`,
      fields: {
        "信号键": `${signal.entityUrl}-${signal.detectedAt ?? signal.windowHours ?? ""}`,
        "视频链接": signal.entityUrl,
        "账号": signal.accountHandle ?? "",
        "窗口": Number(signal.windowHours ?? 0),
        "播放增量": Number(signal.deltas?.views ?? 0),
        "互动增量": Number(signal.deltas?.likes ?? 0) + Number(signal.deltas?.comments ?? 0) + Number(signal.deltas?.shares ?? 0),
        "评分": Number(signal.score ?? 0),
        "提醒状态": signal.alertStatus ?? "待提醒",
        "建议动作": signal.recommendedAction ?? "review"
      }
    })),
    products: products.map((product) => ({
      key: product.productUrl,
      fields: {
        "店铺": product.shopName ?? "",
        "商品链接": product.productUrl,
        "标题": product.title ?? "",
        "价格": Number(product.price ?? 0),
        "销量": Number(product.soldCount ?? 0),
        "评论数": Number(product.reviewCount ?? 0),
        "评分": Number(product.rating ?? 0),
        "最近采集时间": formatFeishuDatetime(product.collectedAt)
      }
    }))
  };
}

export async function syncFeishuBaseDashboard({
  dataDir = "monitoring_data",
  records,
  baseToken,
  tableMap,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  dryRun = false,
  recordMapPath = path.join(dataDir, "base_record_map.json"),
  refreshRecordMap = true,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  ({ baseToken, tableMap } = await resolveBaseDashboardConfig({
    dataDir,
    baseToken,
    tableMap,
    baseDashboardConfigPath
  }));
  if (!baseToken) throw new Error("baseToken is required");
  if (!tableMap) throw new Error("tableMap is required");
  const dashboardRecords = records ?? await buildBaseDashboardRecords({ dataDir });
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
        JSON.stringify(row.fields)
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
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json"),
  recordMapPath = path.join(dataDir, "base_record_map.json"),
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  ({ baseToken, tableMap } = await resolveBaseDashboardConfig({
    dataDir,
    baseToken,
    tableMap,
    baseDashboardConfigPath
  }));
  if (!baseToken) throw new Error("baseToken is required");
  if (!tableMap) throw new Error("tableMap is required");
  const dashboardRecords = records ?? await buildBaseDashboardRecords({ dataDir });
  const recordMap = await readJsonFile(recordMapPath, {});
  let mappedRecordCount = 0;

  for (const [kind, rows] of Object.entries(dashboardRecords)) {
    const tableId = tableMap[kind];
    const keyField = dashboardKeyField(kind);
    if (!tableId || !keyField || !rows.length) continue;
    const args = [
      "base",
      "+record-list",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--limit",
      "200",
      "--format",
      "json"
    ];
    const invocation = buildLarkCliInvocation({ platform, larkCliPath, args });
    const { stdout } = await execLarkCliWithRetry(() =>
      execFileImpl(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
    );
    const listed = parseRecordList(stdout);
    const fieldIndex = listed.fields.indexOf(keyField);
    if (fieldIndex < 0) continue;
    const expectedKeys = new Set(rows.map((row) => row.key));
    for (let index = 0; index < listed.data.length; index += 1) {
      const rowKey = normalizeBaseCell(listed.data[index]?.[fieldIndex]);
      const recordId = listed.recordIds[index];
      if (!rowKey || !recordId || !expectedKeys.has(rowKey)) continue;
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

function mergeAccountsAndCandidates({ accounts, accountCandidates }) {
  const byHandle = new Map();
  for (const account of accounts) {
    if (!account.handle) continue;
    byHandle.set(account.handle, account);
  }
  for (const candidate of accountCandidates) {
    if (!candidate.handle || byHandle.has(candidate.handle)) continue;
    byHandle.set(candidate.handle, {
      ...candidate,
      enabled: false,
      status: "候选"
    });
  }
  return [...byHandle.values()];
}

function countVideosByAccount(videoSnapshots) {
  const byAccount = new Map();
  for (const snapshot of videoSnapshots) {
    if (!snapshot.accountHandle || !snapshot.videoUrl) continue;
    const videos = byAccount.get(snapshot.accountHandle) ?? new Set();
    videos.add(snapshot.videoUrl);
    byAccount.set(snapshot.accountHandle, videos);
  }
  return new Map([...byAccount.entries()].map(([handle, videos]) => [handle, videos.size]));
}

async function resolveBaseDashboardConfig({
  dataDir = "monitoring_data",
  baseToken,
  tableMap,
  baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json")
} = {}) {
  if (baseToken && tableMap) return { baseToken, tableMap };
  const config = await readJsonFile(baseDashboardConfigPath, {});
  return {
    baseToken: baseToken ?? config.baseToken,
    tableMap: tableMap ?? config.tableMap
  };
}

function stringifyProductRefs(productRefs) {
  return (productRefs ?? [])
    .map((ref) => typeof ref === "string" ? ref : ref.productUrl ?? ref.shopUrl)
    .filter(Boolean)
    .join("\n");
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

function dashboardKeyField(kind) {
  return {
    accounts: "账号",
    videos: "视频链接",
    signals: "信号键",
    products: "商品链接"
  }[kind];
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

async function execLarkCliWithRetry(run, attempts = 3) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run();
    } catch (error) {
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
  return /EOF/u.test(message) || /ECONNRESET|ETIMEDOUT|socket hang up/ui.test(message);
}
