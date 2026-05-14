import path from "node:path";

import { ChromeTabLedger } from "./tab-ledger.mjs";
import { ensureMonitorDataDirs, readJsonFile, writeJsonFile } from "./storage.mjs";

const TIKTOK_ORIGIN = "https://www.tiktok.com";

export const DEFAULT_TIKTOK_DISCOVERY_QUERIES = [
  "people skill",
  "people skills",
  "people skill book",
  "People Skills book",
  "people skills connection success",
  "master people skill master your life",
  "raise children street smart",
  "street smart children",
  "children street smart",
  "Raise Children Street Smart",
  "Street Smart children book",
  "children street smart book"
];

export function parseTikTokSearchResults(snapshot, { query = "" } = {}) {
  const text = String(snapshot ?? "");
  const accounts = new Map();
  const videos = [];
  const shops = [];
  const accountPattern = /(?:https?:\/\/(?:www\.)?tiktok\.com)?\/@([A-Za-z0-9._-]+)(?:\/video\/(\d+))?/giu;
  for (const match of text.matchAll(accountPattern)) {
    const handle = match[1];
    const videoId = match[2];
    const context = directionalText(text, match.index ?? 0, 20, 140);
    const accountLine = lineAt(text, match.index ?? 0);
    const account = accounts.get(handle) ?? {
      id: `candidate-${slugify(handle)}`,
      handle,
      profileUrl: `${TIKTOK_ORIGIN}/@${handle}`,
      sourceQuery: query,
      relatedBooks: [],
      hasCommerce: false,
      evidenceUrls: [],
      status: "candidate"
    };
    account.relatedBooks = mergeUnique(account.relatedBooks, detectRelatedBooks(accountLine), detectRelatedBooks(context));
    account.hasCommerce = account.hasCommerce || hasCommerceSignal(context);
    if (videoId) {
      const videoUrl = `${TIKTOK_ORIGIN}/@${handle}/video/${videoId}`;
      account.evidenceUrls = mergeUnique(account.evidenceUrls, [videoUrl]);
      videos.push({ handle, videoUrl, sourceQuery: query });
    }
    accounts.set(handle, account);
  }

  for (const shop of collectShopRefs(text, { query, linkNearbyHandles: false })) {
    shops.push(shop);
  }

  for (const shop of shops) {
    for (const handle of shop.linkedHandles ?? []) {
      const account = accounts.get(handle);
      if (!account) continue;
      account.hasCommerce = true;
      account.relatedBooks = mergeUnique(account.relatedBooks, shop.relatedBooks ?? []);
    }
  }

  return {
    query,
    accounts: [...accounts.values()],
    videos: dedupeBy(videos, (video) => video.videoUrl),
    shops: dedupeBy(shops, (shop) => shop.shopUrl ?? shop.productUrl)
  };
}

export function parseTikTokProfileShopRefs(snapshot, { handle, profileUrl, relatedBooks = [] } = {}) {
  const refs = collectShopRefs(String(snapshot ?? ""), {
    handle,
    profileUrl,
    relatedBooks: mergeUnique(relatedBooks, detectRelatedBooks(snapshot))
  });
  if (/\/shop\/(?:p|product|pdp)\//iu.test(String(profileUrl ?? ""))) {
    return refs.map((ref) => ({
      ...ref,
      productUrl: ref.productUrl ?? (ref.shopUrl ? profileUrl : undefined)
    }));
  }
  return refs;
}

export function selectQualifiedAccountCandidates(accounts = []) {
  return accounts
    .filter((account) => account.relatedBooks?.length && account.hasCommerce)
    .sort((left, right) => left.handle.localeCompare(right.handle));
}

export async function mergeAccountCandidates({ dataDir = "monitoring_data", candidates = [], now = new Date() } = {}) {
  await ensureMonitorDataDirs(dataDir);
  const filePath = path.join(dataDir, "seeds", "account_candidates.json");
  const existing = await readJsonFile(filePath, []);
  const byHandle = new Map(existing.map((account) => [account.handle, account]));
  const discoveredAt = new Date(now).toISOString();

  for (const candidate of candidates) {
    if (!candidate.handle) continue;
    const current = byHandle.get(candidate.handle) ?? {};
    byHandle.set(candidate.handle, {
      id: current.id ?? candidate.id ?? `candidate-${slugify(candidate.handle)}`,
      handle: candidate.handle,
      profileUrl: candidate.profileUrl ?? current.profileUrl ?? `${TIKTOK_ORIGIN}/@${candidate.handle}`,
      status: current.status ?? "candidate",
      sourceQuery: candidate.sourceQuery ?? current.sourceQuery,
      relatedBooks: mergeUnique(current.relatedBooks ?? [], candidate.relatedBooks ?? []),
      hasCommerce: Boolean(current.hasCommerce || candidate.hasCommerce),
      evidenceUrls: mergeUnique(current.evidenceUrls ?? [], candidate.evidenceUrls ?? []),
      firstDiscoveredAt: current.firstDiscoveredAt ?? discoveredAt,
      lastDiscoveredAt: discoveredAt
    });
  }

  await writeJsonFile(filePath, [...byHandle.values()].sort((left, right) => left.handle.localeCompare(right.handle)));
  return { path: filePath, written: byHandle.size };
}

export async function mergeDiscoveredShops({ dataDir = "monitoring_data", shops = [], now = new Date() } = {}) {
  await ensureMonitorDataDirs(dataDir);
  const filePath = path.join(dataDir, "seeds", "shops.json");
  const existing = await readJsonFile(filePath, []);
  const byKey = new Map(existing.map((shop) => [shop.shopUrl || shop.productUrl, shop]));
  const discoveredAt = new Date(now).toISOString();

  for (const shop of shops) {
    const key = shop.shopUrl || shop.productUrl;
    if (!key) continue;
    const current = byKey.get(key) ?? {};
    const hasShopUrl = Boolean(shop.shopUrl ?? current.shopUrl);
    byKey.set(key, {
      id: current.id ?? shop.id ?? `shop-${slugify(key)}`,
      name: current.name ?? shop.shopName ?? shop.name ?? titleFromUrl(shop.shopUrl ?? shop.productUrl ?? key),
      shopUrl: shop.shopUrl ?? current.shopUrl,
      productUrl: shop.productUrl ?? current.productUrl,
      enabled: current.enabled ?? hasShopUrl,
      status: current.status ?? (hasShopUrl ? undefined : "candidate"),
      sourceQuery: shop.sourceQuery ?? current.sourceQuery,
      relatedBooks: mergeUnique(current.relatedBooks ?? [], shop.relatedBooks ?? []),
      linkedHandles: mergeUnique(current.linkedHandles ?? [], shop.linkedHandles ?? []),
      evidenceUrls: mergeUnique(current.evidenceUrls ?? [], shop.evidenceUrls ?? []),
      firstDiscoveredAt: current.firstDiscoveredAt ?? discoveredAt,
      lastDiscoveredAt: discoveredAt,
      discoveredFrom: current.discoveredFrom ?? "search_discovery"
    });
  }

  await writeJsonFile(
    filePath,
    [...byKey.values()].sort((left, right) =>
      String(left.shopUrl || left.productUrl).localeCompare(String(right.shopUrl || right.productUrl))
    )
  );
  return { path: filePath, written: byKey.size };
}

export async function discoverChromeAccountCandidates({
  dataDir = "monitoring_data",
  browserClient,
  queries = DEFAULT_TIKTOK_DISCOVERY_QUERIES,
  now = new Date(),
  maxTabs = 2,
  queryTimeoutMs = 45_000,
  profileTimeoutMs = 15_000
} = {}) {
  if (!browserClient) {
    throw new Error("chrome_unavailable: browserClient is required for discovery");
  }
  const ledger = new ChromeTabLedger({ browser: browserClient, maxTabs });
  const candidates = [];
  const shops = [];
  const failures = [];

  try {
    const listTab = await ledger.acquire("search-list");
    for (const query of queries) {
      try {
        const queryRelatedBooks = detectRelatedBooks(query);
        const parsed = await withTimeout(
          collectSearchQuery({ browserClient, listTab, query }),
          queryTimeoutMs,
          `search query timed out after ${queryTimeoutMs}ms`
        );
        shops.push(...parsed.shops);
        const bookRelatedAccounts = parsed.accounts.filter((account) => {
          if (account.relatedBooks?.length) return true;
          if (!queryRelatedBooks.length) return false;
          account.relatedBooks = mergeUnique(account.relatedBooks ?? [], queryRelatedBooks);
          return true;
        });
        for (const account of bookRelatedAccounts) {
          try {
            const refs = await withTimeout(
              collectProfileShopRefs({ browserClient, listTab, account, query }),
              profileTimeoutMs,
              `profile shop discovery timed out after ${profileTimeoutMs}ms`
            );
            shops.push(...refs);
            if (refs.length) {
              account.hasCommerce = true;
              account.evidenceUrls = mergeUnique(
                account.evidenceUrls ?? [],
                refs.map((ref) => ref.shopUrl ?? ref.productUrl)
              );
            }
          } catch (error) {
            failures.push({
              query,
              handle: account.handle,
              status: "failed",
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
        candidates.push(...bookRelatedAccounts);
      } catch (error) {
        failures.push({ query, status: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await ledger.cleanup();
  }

  const merged = await mergeAccountCandidates({ dataDir, candidates, now });
  const mergedShops = await mergeDiscoveredShops({ dataDir, shops, now });
  const commerceCandidates = selectQualifiedAccountCandidates(candidates).length;
  return {
    source: "chrome",
    queries: queries.length,
    candidates: candidates.length,
    commerceCandidates,
    shops: dedupeBy(shops, (shop) => shop.shopUrl ?? shop.productUrl).length,
    failures,
    candidatesPath: merged.path,
    shopsPath: mergedShops.path
  };
}

export async function discoverChromeShopsFromAccounts({
  dataDir = "monitoring_data",
  browserClient,
  accounts = [],
  now = new Date(),
  maxTabs = 1,
  maxEvidenceVideosPerAccount = 2,
  maxProfileVideosPerAccount = 2
} = {}) {
  if (!browserClient) {
    throw new Error("chrome_unavailable: browserClient is required for shop discovery");
  }
  const ledger = new ChromeTabLedger({ browser: browserClient, maxTabs });
  const discovered = [];
  const failures = [];
  let processedAccounts = 0;

  try {
    const tab = await ledger.acquire("shop-discovery");
    for (const account of accounts) {
      if (!account?.profileUrl && !(account?.evidenceUrls?.length)) continue;
      processedAccounts += 1;
      const refs = [];
      let profileVideos = [];

      if (account.profileUrl) {
        try {
          await browserClient.navigate(tab, account.profileUrl);
          refs.push(...(await collectProfileShopRefs({ browserClient, listTab: tab, account, query: account.sourceQuery })));
          profileVideos = await collectProfileVideos({
            browserClient,
            profileTab: tab,
            account,
            maxVideos: maxProfileVideosPerAccount
          });
        } catch (error) {
          failures.push({
            handle: account.handle,
            target: account.profileUrl,
            status: "profile_failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const candidateVideoUrls = [...new Set([...(account.evidenceUrls ?? []), ...profileVideos.map((video) => video.videoUrl)])]
        .slice(0, maxEvidenceVideosPerAccount);

      for (const videoUrl of candidateVideoUrls) {
        try {
          await browserClient.navigate(tab, videoUrl);
          const detail = await extractDirectVideoForDiscovery({ browserClient, detailTab: tab, videoUrl, account });
          if (detail.status !== "ok") continue;
          for (const ref of detail.video.productRefs ?? []) {
            refs.push(normalizeDiscoveredRef(ref, account, [videoUrl]));
            if (ref.productUrl && !ref.shopUrl) {
              try {
                await browserClient.navigate(tab, ref.productUrl);
                const productRefs = await collectProfileShopRefs({
                  browserClient,
                  listTab: tab,
                  account: { ...account, profileUrl: ref.productUrl },
                  query: account.sourceQuery
                });
                refs.push(...productRefs.map((item) => normalizeDiscoveredRef(item, account, [videoUrl, ref.productUrl])));
              } catch (error) {
                failures.push({
                  handle: account.handle,
                  target: ref.productUrl,
                  status: "product_failed",
                  reason: error instanceof Error ? error.message : String(error)
                });
              }
            }
          }
        } catch (error) {
          failures.push({
            handle: account.handle,
            target: videoUrl,
            status: "video_failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      discovered.push(...consolidateDiscoveredRefs(refs.filter((item) => item.shopUrl || item.productUrl)));
    }
  } finally {
    await ledger.cleanup();
  }

  const consolidated = consolidateDiscoveredRefs(discovered);
  const merged = await mergeDiscoveredShops({ dataDir, shops: consolidated, now });
  return {
    source: "chrome",
    processedAccounts,
    discoveredShops: consolidated.length,
    failures,
    shopsPath: merged.path
  };
}

async function collectSearchQuery({ browserClient, listTab, query }) {
  await browserClient.navigate(listTab, buildTikTokSearchUrl(query));
  return browserClient.extractSearchResults
    ? browserClient.extractSearchResults({ listTab, query })
    : parseTikTokSearchResults(await listTab.playwright.domSnapshot(), { query });
}

async function collectProfileShopRefs({ browserClient, listTab, account, query }) {
  await browserClient.navigate(listTab, account.profileUrl);
  const pageUrl = listTab?.url ?? listTab?.currentUrl ?? account.profileUrl;
  const refs = browserClient.extractProfileShopRefs
    ? await browserClient.extractProfileShopRefs({ profileTab: listTab, account, query, pageUrl })
    : listTab.playwright?.domSnapshot
      ? parseTikTokProfileShopRefs(await listTab.playwright.domSnapshot(), {
          handle: account.handle,
          profileUrl: pageUrl,
          relatedBooks: account.relatedBooks
        })
      : [];

  return refs.map((ref) => ({
    ...ref,
    sourceQuery: ref.sourceQuery ?? query,
    relatedBooks: mergeUnique(account.relatedBooks ?? [], ref.relatedBooks ?? []),
    linkedHandles: mergeUnique([account.handle], ref.linkedHandles ?? []),
    evidenceUrls: mergeUnique([pageUrl], ref.evidenceUrls ?? [])
  }));
}

async function collectProfileVideos({ browserClient, profileTab, account, maxVideos }) {
  if (browserClient.extractProfileVideos) {
    return browserClient.extractProfileVideos({ profileTab, account, maxVideos });
  }
  if (profileTab.playwright?.domSnapshot) {
    return [];
  }
  return [];
}

async function extractDirectVideoForDiscovery({ browserClient, detailTab, videoUrl, account }) {
  if (browserClient.extractDirectVideo) {
    return browserClient.extractDirectVideo({
      detailTab,
      video: {
        videoUrl,
        accountHandle: account.handle
      }
    });
  }
  return { status: "missing_metrics", reason: "browser client does not support direct video discovery" };
}

function normalizeDiscoveredRef(ref, account, evidenceUrls) {
  return {
    ...ref,
    linkedHandles: mergeUnique(ref.linkedHandles ?? [], [account.handle]),
    relatedBooks: mergeUnique(ref.relatedBooks ?? [], account.relatedBooks ?? []),
    sourceQuery: ref.sourceQuery ?? account.sourceQuery,
    evidenceUrls: mergeUnique(ref.evidenceUrls ?? [], evidenceUrls ?? [])
  };
}

function consolidateDiscoveredRefs(refs = []) {
  const byProduct = new Map();
  const byShop = new Map();

  for (const ref of refs) {
    if (ref.productUrl) {
      const key = ref.productUrl;
      const current = byProduct.get(key) ?? {};
      byProduct.set(key, mergeDiscoveredRef(current, ref));
      continue;
    }
    if (ref.shopUrl) {
      const key = ref.shopUrl;
      const current = byShop.get(key) ?? {};
      byShop.set(key, mergeDiscoveredRef(current, ref));
    }
  }

  for (const [shopUrl, shopRef] of byShop.entries()) {
    const matchingProduct = [...byProduct.values()].find((ref) => ref.shopUrl === shopUrl);
    if (matchingProduct) {
      byProduct.set(matchingProduct.productUrl, mergeDiscoveredRef(matchingProduct, shopRef));
      byShop.delete(shopUrl);
    }
  }

  return [...byProduct.values(), ...byShop.values()];
}

function mergeDiscoveredRef(current, incoming) {
  return {
    ...current,
    ...incoming,
    shopUrl: incoming.shopUrl ?? current.shopUrl,
    productUrl: incoming.productUrl ?? current.productUrl,
    shopName: incoming.shopName ?? current.shopName,
    linkedHandles: mergeUnique(current.linkedHandles ?? [], incoming.linkedHandles ?? []),
    relatedBooks: mergeUnique(current.relatedBooks ?? [], incoming.relatedBooks ?? []),
    evidenceUrls: mergeUnique(current.evidenceUrls ?? [], incoming.evidenceUrls ?? [])
  };
}

export function buildTikTokSearchUrl(query) {
  const url = new URL("/search", TIKTOK_ORIGIN);
  url.searchParams.set("q", query);
  return url.toString();
}

function detectRelatedBooks(text) {
  const normalized = String(text ?? "").toLowerCase();
  const books = [];
  if (/people\s+skills?|connection\s*=\s*success|master\s+people\s+skill/i.test(normalized)) {
    books.push("people_skills");
  }
  if (/raise\s+children\s+street\s+smart|street\s+smart\s+children|children\s+street\s+smart/i.test(normalized)) {
    books.push("raise_children_street_smart");
  }
  return books;
}

function hasCommerceSignal(text) {
  return /\/shop\/|buy|cart|product|showcase|橱窗|店铺|购买|商品/iu.test(String(text ?? ""));
}

function collectShopRefs(text, { query = "", handle, profileUrl, relatedBooks = [], linkNearbyHandles = true } = {}) {
  const refs = [];
  const baseRelatedBooks = mergeUnique(relatedBooks, detectRelatedBooks(query), detectRelatedBooks(text));
  const productPattern = /(?:https?:\/\/(?:www\.)?tiktok\.com)?\/shop\/(?:p|product|pdp)\/[^\s"'<>）)]+/giu;
  const shopPattern = /(?:https?:\/\/(?:www\.)?tiktok\.com)?\/shop\/(?!p\/|product\/|pdp\/)[^\s"'<>）)]+/giu;

  for (const match of text.matchAll(shopPattern)) {
    const shopUrl = normalizeTikTokUrl(match[0]);
    if (!shopUrl) continue;
    const context = nearbyText(text, match.index ?? 0, 300);
    refs.push({
      shopUrl,
      shopName: titleFromUrl(shopUrl),
      sourceQuery: query,
      relatedBooks: mergeUnique(baseRelatedBooks, detectRelatedBooks(context)),
      linkedHandles: mergeUnique(handle ? [handle] : [], linkNearbyHandles ? extractHandles(context) : []),
      evidenceUrls: mergeUnique([profileUrl, shopUrl])
    });
  }

  for (const match of text.matchAll(productPattern)) {
    const productUrl = normalizeTikTokUrl(match[0]);
    if (!productUrl) continue;
    const context = nearbyText(text, match.index ?? 0, 300);
    refs.push({
      productUrl,
      shopName: titleFromUrl(productUrl),
      sourceQuery: query,
      relatedBooks: mergeUnique(baseRelatedBooks, detectRelatedBooks(context)),
      linkedHandles: mergeUnique(handle ? [handle] : [], linkNearbyHandles ? extractHandles(context) : []),
      evidenceUrls: mergeUnique([profileUrl, productUrl])
    });
  }

  return dedupeBy(refs, (ref) => ref.shopUrl ?? ref.productUrl);
}

function nearbyText(text, index, radius) {
  return text.slice(Math.max(0, index - radius), index + radius);
}

function directionalText(text, index, beforeRadius, afterRadius) {
  return text.slice(Math.max(0, index - beforeRadius), index + afterRadius);
}

function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index);
  const end = text.indexOf("\n", index);
  return text.slice(start + 1, end === -1 ? text.length : end);
}

function normalizeTikTokUrl(value) {
  const raw = String(value ?? "").replace(/[，。,.;；]+$/u, "");
  if (raw.startsWith("http")) return raw.split("?")[0];
  if (raw.startsWith("/")) return `${TIKTOK_ORIGIN}${raw}`.split("?")[0];
  return raw;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function slugify(value) {
  return String(value ?? "candidate")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "candidate";
}

function titleFromUrl(value) {
  return String(value ?? "TikTok Shop").split("/").filter(Boolean).at(-1)?.replace(/[-_]+/gu, " ") ?? "TikTok Shop";
}

function extractHandles(text) {
  return [...String(text ?? "").matchAll(/\/@([A-Za-z0-9._-]+)/giu)].map((match) => match[1]);
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}
