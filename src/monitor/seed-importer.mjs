import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ensureMonitorDataDirs, readJsonFile, writeJsonFile } from "./storage.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LARK_CLI = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";

export async function importSeedsFromFeishuWiki({
  dataDir = "monitoring_data",
  url,
  fromFile,
  fetchText,
  execFileImpl = execFileAsync,
  larkCliPath = DEFAULT_LARK_CLI
} = {}) {
  if (!url && !fromFile) {
    throw new Error("seed import requires --url or --from-file");
  }

  if (fromFile) {
    const text = await readFile(path.resolve(fromFile), "utf8");
    return { ...(await importSeedsFromText({ dataDir, text })), source: "file" };
  }

  const text = fetchText
    ? await fetchText(url)
    : await fetchFeishuText({ url, execFileImpl, larkCliPath });
  return { ...(await importSeedsFromText({ dataDir, text })), source: "feishu" };
}

export async function importSeedsFromText({ dataDir = "monitoring_data", text } = {}) {
  await ensureMonitorDataDirs(dataDir);
  const parsed = extractTikTokSeedsFromText(text);
  const target = await mergeSeedCollections({
    dataDir,
    accounts: parsed.accounts,
    shops: parsed.shops,
    videos: parsed.videos
  });

  return {
    accounts: parsed.accounts.length,
    shops: parsed.shops.length,
    videos: parsed.videos.length,
    accountsPath: target.accountsPath,
    shopsPath: target.shopsPath,
    videosPath: target.videosPath
  };
}

export async function mergeHistoricalSeedRuns({ dataDir = "monitoring_data", runDirs } = {}) {
  await ensureMonitorDataDirs(dataDir);
  const sourceDirs = runDirs?.length ? runDirs.map((value) => path.resolve(value)) : await listSeedRunDirs(dataDir);
  const merged = {
    accounts: [],
    shops: [],
    videos: []
  };

  for (const dir of sourceDirs) {
    if (path.resolve(dir) === path.resolve(dataDir)) continue;
    const seedsDir = path.join(dir, "seeds");
    merged.accounts.push(...(await readJsonFile(path.join(seedsDir, "accounts.json"), [])));
    merged.shops.push(...(await readJsonFile(path.join(seedsDir, "shops.json"), [])));
    merged.videos.push(...(await readJsonFile(path.join(seedsDir, "videos.json"), [])));
  }

  const target = await mergeSeedCollections({
    dataDir,
    accounts: merged.accounts,
    shops: merged.shops,
    videos: merged.videos
  });

  return {
    dataDir: path.resolve(dataDir),
    sourceRuns: sourceDirs.length,
    sourceDirectories: sourceDirs,
    imported: {
      accounts: merged.accounts.length,
      shops: merged.shops.length,
      videos: merged.videos.length
    },
    target: {
      accounts: target.accounts.length,
      shops: target.shops.length,
      videos: target.videos.length
    },
    paths: {
      accounts: target.accountsPath,
      shops: target.shopsPath,
      videos: target.videosPath
    }
  };
}

export async function promoteAccountCandidates({ dataDir = "monitoring_data", handles } = {}) {
  await ensureMonitorDataDirs(dataDir);
  const accountsPath = path.join(dataDir, "seeds", "accounts.json");
  const candidatesPath = path.join(dataDir, "seeds", "account_candidates.json");
  const existingAccounts = await readJsonFile(accountsPath, []);
  const accountCandidates = await readJsonFile(candidatesPath, []);
  const selectedHandles = handles?.length ? new Set(handles) : null;
  const selectedCandidates = accountCandidates.filter((candidate) => candidate.handle && (!selectedHandles || selectedHandles.has(candidate.handle)));
  const promotedAccounts = selectedCandidates.map((candidate) => ({
    id: `account-${slugify(candidate.handle)}`,
    handle: candidate.handle,
    profileUrl: candidate.profileUrl ?? `https://www.tiktok.com/@${candidate.handle}`,
    enabled: true,
    sourceQuery: candidate.sourceQuery,
    relatedBooks: candidate.relatedBooks ?? [],
    hasCommerce: Boolean(candidate.hasCommerce),
    evidenceUrls: candidate.evidenceUrls ?? [],
    discoveredFrom: candidate.discoveredFrom ?? "search",
    firstDiscoveredAt: candidate.firstDiscoveredAt,
    lastDiscoveredAt: candidate.lastDiscoveredAt
  }));
  const mergedAccounts = mergeByKey(existingAccounts, promotedAccounts, (item) => item.handle).sort((left, right) =>
    String(left.handle).localeCompare(String(right.handle))
  );

  await writeJsonFile(accountsPath, mergedAccounts);

  return {
    dataDir: path.resolve(dataDir),
    promoted: promotedAccounts.length,
    selectedCandidates: selectedCandidates.length,
    target: {
      accounts: mergedAccounts.length
    },
    paths: {
      accounts: accountsPath,
      candidates: candidatesPath
    }
  };
}

export function extractTikTokSeedsFromText(text) {
  const raw = String(text ?? "");
  const urls = [...raw.matchAll(/https?:\/\/(?:www\.)?tiktok\.com\/[^\s"'<>）)]+/giu)].map((match) =>
    match[0].replace(/[，。,.;；]+$/u, "")
  );
  const accounts = new Map();
  const shops = new Map();
  const videos = new Map();

  for (const url of urls) {
    const accountMatch = url.match(/tiktok\.com\/@([A-Za-z0-9._-]+)/iu);
    if (accountMatch) {
      const handle = accountMatch[1];
      accounts.set(handle, {
        id: `account-${slugify(handle)}`,
        handle,
        profileUrl: `https://www.tiktok.com/@${handle}`,
        enabled: true
      });
    }

    if (/tiktok\.com\/(?:@[^/]+\/video\/\d+|t\/[A-Za-z0-9]+)/iu.test(url)) {
      const normalizedVideoUrl = url.split("?")[0].replace(/\/$/u, "");
      videos.set(normalizedVideoUrl, {
        id: `video-${slugify(normalizedVideoUrl.split("/").filter(Boolean).at(-1) ?? "video")}`,
        videoUrl: normalizedVideoUrl,
        accountHandle: accountMatch?.[1],
        enabled: true
      });
    }

    if (/tiktok\.com\/shop\//iu.test(url)) {
      const normalized = url.split("?")[0].replace(/\/$/u, "");
      shops.set(normalized, {
        id: `shop-${slugify(normalized.split("/").filter(Boolean).at(-1) ?? "shop")}`,
        name: titleFromShopUrl(normalized),
        shopUrl: normalized,
        enabled: true
      });
    }
  }

  return {
    accounts: [...accounts.values()].sort((left, right) => left.handle.localeCompare(right.handle)),
    shops: [...shops.values()].sort((left, right) => left.shopUrl.localeCompare(right.shopUrl)),
    videos: [...videos.values()].sort((left, right) => left.videoUrl.localeCompare(right.videoUrl))
  };
}

async function mergeSeedCollections({ dataDir, accounts = [], shops = [], videos = [] } = {}) {
  const accountsPath = path.join(dataDir, "seeds", "accounts.json");
  const shopsPath = path.join(dataDir, "seeds", "shops.json");
  const videosPath = path.join(dataDir, "seeds", "videos.json");
  const existingAccounts = await readJsonFile(accountsPath, []);
  const existingShops = await readJsonFile(shopsPath, []);
  const existingVideos = await readJsonFile(videosPath, []);

  const mergedAccounts = mergeByKey(existingAccounts, accounts, (item) => item.handle).sort((left, right) =>
    String(left.handle).localeCompare(String(right.handle))
  );
  const mergedShops = mergeByKey(existingShops, shops, (item) => item.shopUrl ?? item.productUrl).sort((left, right) =>
    String(left.shopUrl ?? left.productUrl).localeCompare(String(right.shopUrl ?? right.productUrl))
  );
  const mergedVideos = mergeByKey(existingVideos, videos, (item) => item.videoUrl).sort((left, right) =>
    String(left.videoUrl).localeCompare(String(right.videoUrl))
  );

  await writeJsonFile(accountsPath, mergedAccounts);
  await writeJsonFile(shopsPath, mergedShops);
  await writeJsonFile(videosPath, mergedVideos);

  return {
    accounts: mergedAccounts,
    shops: mergedShops,
    videos: mergedVideos,
    accountsPath,
    shopsPath,
    videosPath
  };
}

async function fetchFeishuText({ url, execFileImpl, larkCliPath }) {
  const cliArgs = ["docs", "+fetch", "--api-version", "v2", "--doc", url, "--doc-format", "markdown", "--format", "json"];
  const invocation = buildLarkCliInvocation({ larkCliPath, args: cliArgs });
  try {
    const { stdout } = await execFileImpl(
      invocation.command,
      invocation.args,
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, windowsHide: true }
    );
    return extractLarkFetchContent(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `feishu_seed_import_failed: cannot fetch wiki through lark-cli; export the wiki to a text file and retry with --from-file. ${message}`
    );
  }
}

export function buildLarkCliInvocation({ platform = process.platform, larkCliPath = DEFAULT_LARK_CLI, args = [] } = {}) {
  if (platform === "win32") {
    const commandArg = shouldQuoteWindowsCommand(larkCliPath) ? `"${larkCliPath}"` : larkCliPath;
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandArg, ...args]
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

function extractLarkFetchContent(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.data?.document?.content ?? stdout;
  } catch {
    return stdout;
  }
}

function mergeByKey(existing, incoming, keyFn) {
  const byKey = new Map();
  for (const item of existing) {
    const key = keyFn(item);
    if (key) byKey.set(key, item);
  }
  for (const item of incoming) {
    const key = keyFn(item);
    if (!key) continue;
    byKey.set(key, { ...byKey.get(key), ...item });
  }
  return [...byKey.values()];
}

async function listSeedRunDirs(dataDir) {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "seeds" || entry.name.startsWith(".")) continue;
    const dir = path.join(dataDir, entry.name);
    const hasSeedFiles = (
      await Promise.all([
        readJsonFile(path.join(dir, "seeds", "accounts.json"), null),
        readJsonFile(path.join(dir, "seeds", "shops.json"), null),
        readJsonFile(path.join(dir, "seeds", "videos.json"), null)
      ])
    ).some((value) => Array.isArray(value) && value.length >= 0);
    if (hasSeedFiles) dirs.push(dir);
  }
  return dirs;
}

function titleFromShopUrl(url) {
  return (url.split("/").filter(Boolean).at(-1) ?? "TikTok Shop").replace(/[-_]+/gu, " ");
}

function slugify(value) {
  return String(value ?? "seed")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "seed";
}
