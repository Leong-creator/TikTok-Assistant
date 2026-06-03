import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { buildLarkCliInvocation } from "./alerts.mjs";
import { ensureMonitorDataDirs, readJsonFile, writeJsonFile } from "./storage.mjs";

const execFileAsync = promisify(execFile);

export const WHITELIST_TABLE_NAMES = [
  "People Skills",
  "Raise Children",
  "Make More Money",
  "墨菲定律",
  "其他品"
];
const WHITELIST_CONFIG_FILE = "base_dashboard_whitelist_config.json";
const DEFAULT_CONFIG_FILE = "base_dashboard_config.json";
const WHITELIST_CACHE_FILE = path.join("state", "whitelist_accounts_cache.json");

export async function loadWhitelistAccounts({
  dataDir = "monitoring_data",
  baseToken,
  baseDashboardConfigPath,
  larkCliPath = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
  execFileImpl = execFileAsync,
  platform = process.platform
} = {}) {
  await ensureMonitorDataDirs(dataDir);
  const resolvedConfigPath = await resolveWhitelistConfigPath({ dataDir, baseDashboardConfigPath });
  const resolvedBaseToken = baseToken ?? (await readJsonFile(resolvedConfigPath, {})).baseToken;
  const cachedRows = await readWhitelistAccountCache({ dataDir });
  if (!resolvedBaseToken) return cachedRows;
  let tables = [];
  try {
    tables = await listBaseTables({ baseToken: resolvedBaseToken, larkCliPath, execFileImpl, platform });
  } catch {
    return cachedRows;
  }
  const tableByName = new Map(tables.map((table) => [String(table.name ?? "").trim(), table]));
  const rows = [];

  try {
    for (const tableName of WHITELIST_TABLE_NAMES) {
      const table = tableByName.get(tableName);
      if (!table?.id) continue;
      const records = await listBaseRecords({ baseToken: resolvedBaseToken, tableId: table.id, larkCliPath, execFileImpl, platform });
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const accountName = String(readNamedCell(record, ["账号名", "账号", "Account"]) ?? "").trim();
        const profileUrl = String(readNamedCell(record, ["主页链接", "主页", "Profile URL"]) ?? "").trim();
        const handle = deriveTikTokHandle({ accountName, profileUrl });
        if (!handle) continue;
        const materialType = String(readNamedCell(record, ["素材类型", "类型"]) ?? "").trim();
        const productName = String(readNamedCell(record, ["商品", "产品名", "Product"]) ?? "").trim();
        const remark = String(readNamedCell(record, ["备注", "Remark"]) ?? "").trim();
        const recordId = String(record.__recordId ?? "").trim();
        rows.push({
          id: buildWhitelistRowId({ tableName, recordId, rowIndex: index, handle }),
          handle,
          accountName: accountName || handle,
          profileUrl,
          sourceTable: tableName,
          sourceTables: [tableName],
          materialType,
          productName,
          materialTypes: materialType ? [materialType] : [],
          recordId,
          remark,
          remarks: remark ? [remark] : [],
          skipTracking: /橱窗已掉/u.test(remark),
          enabled: true
        });
      }
    }
  } catch {
    return cachedRows;
  }

  if (rows.length) {
    await writeWhitelistAccountCache({ dataDir, rows });
  }
  return rows;
}

export async function isWhitelistSourceConfigured({
  dataDir = "monitoring_data",
  baseDashboardConfigPath
} = {}) {
  if (isWhitelistConfigPath(baseDashboardConfigPath)) {
    const explicitConfig = await readJsonFile(baseDashboardConfigPath, null);
    if (explicitConfig?.baseToken) return true;
  } else {
    const whitelistConfig = await readJsonFile(path.join(dataDir, WHITELIST_CONFIG_FILE), null);
    if (whitelistConfig?.baseToken) return true;
  }
  const cachedRows = await readWhitelistAccountCache({ dataDir });
  return cachedRows.length > 0;
}

export function deriveTikTokHandle({ accountName = "", profileUrl = "" } = {}) {
  const normalizedUrl = String(profileUrl ?? "").trim();
  const urlHandle = normalizedUrl.match(/tiktok\.com\/@([^/?#]+)/iu)?.[1];
  if (urlHandle) return urlHandle.trim();
  const normalizedName = String(accountName ?? "").trim();
  return normalizedName || "";
}

async function listBaseTables({ baseToken, larkCliPath, execFileImpl, platform }) {
  const args = ["base", "+table-list", "--base-token", baseToken, "--offset", "0", "--limit", "200"];
  const { stdout } = await runLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
  const parsed = JSON.parse(stdout);
  return parsed.data?.tables ?? [];
}

async function listBaseRecords({ baseToken, tableId, larkCliPath, execFileImpl, platform }) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
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
      "200",
      "--format",
      "json"
    ];
    const { stdout } = await runLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args });
    const parsed = parseRecordList(stdout);
    for (let index = 0; index < parsed.data.length; index += 1) {
      rows.push(materializeRecord(parsed.fields, parsed.data[index], parsed.recordIds[index]));
    }
    if (parsed.data.length < 200) break;
  }
  return rows;
}

function materializeRecord(fields = [], row = [], recordId = "") {
  const record = {};
  for (let index = 0; index < fields.length; index += 1) {
    record[String(fields[index] ?? "").trim()] = normalizeBaseCell(row[index]);
  }
  record.__recordId = String(recordId ?? "").trim();
  return record;
}

function readNamedCell(record, fieldNames = []) {
  for (const name of fieldNames) {
    const value = record?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
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

function buildWhitelistRowId({ tableName = "", recordId = "", rowIndex = 0, handle = "" } = {}) {
  const tableSlug = slugify(tableName || "table");
  const recordSlug = slugify(recordId || `row-${rowIndex + 1}`);
  const handleSlug = slugify(handle || `account-${rowIndex + 1}`);
  return `whitelist-${tableSlug}-${recordSlug}-${handleSlug}`;
}

async function resolveWhitelistConfigPath({ dataDir, baseDashboardConfigPath } = {}) {
  if (baseDashboardConfigPath) return baseDashboardConfigPath;
  const whitelistConfigPath = path.join(dataDir, WHITELIST_CONFIG_FILE);
  const whitelistConfig = await readJsonFile(whitelistConfigPath, null);
  if (whitelistConfig) return whitelistConfigPath;
  return path.join(dataDir, DEFAULT_CONFIG_FILE);
}

function isWhitelistConfigPath(filePath) {
  return String(filePath ?? "").toLowerCase().includes("whitelist");
}

async function readWhitelistAccountCache({ dataDir = "monitoring_data" } = {}) {
  return readJsonFile(path.join(dataDir, WHITELIST_CACHE_FILE), []);
}

async function writeWhitelistAccountCache({ dataDir = "monitoring_data", rows = [] } = {}) {
  await writeJsonFile(path.join(dataDir, WHITELIST_CACHE_FILE), rows);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, "-")
    .replace(/^-+|-+$/g, "") || "row";
}

async function runLarkCli({ larkCliPath, execFileImpl, platform, args }) {
  const invocation = buildLarkCliInvocation({ larkCliPath, platform, args });
  return execFileImpl(invocation.command, invocation.args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });
}

async function runLarkCliWithRetry({ larkCliPath, execFileImpl, platform, args, retries = 4 }) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await runLarkCli({ larkCliPath, execFileImpl, platform, args });
    } catch (error) {
      lastError = error;
      if (!isRetryableLarkError(error) || attempt === retries - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isRetryableLarkError(error) {
  const message = String(error?.stderr ?? error?.message ?? error ?? "");
  return /EOF|timed out|timeout|ECONNRESET|socket hang up|Temporary failure/i.test(message);
}
