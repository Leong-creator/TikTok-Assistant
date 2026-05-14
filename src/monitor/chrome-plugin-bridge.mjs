import { parseTikTokProfileShopRefs, parseTikTokSearchResults } from "./discovery.mjs";

const TIKTOK_ORIGIN = "https://www.tiktok.com";

export function createChromePluginBrowserClient({
  browser,
  maxVideosPerAccount = 6,
  maxProductsPerShop = 6,
  waitUntil = "domcontentloaded",
  timeoutMs = 15_000,
  snapshotTimeoutMs = timeoutMs,
  closeTimeoutMs = 5_000,
  snapshotRetries = 8,
  snapshotRetryDelayMs = 1_000
} = {}) {
  if (!browser?.tabs?.new) {
    throw new Error("chrome_plugin_unavailable: browser.tabs.new is required");
  }

  const client = {
    usesDetailTab: true,
    async createTab() {
      return browser.tabs.new();
    },
    async closeTab(tab) {
      if (tab?.close) await withTimeout(tab.close(), closeTimeoutMs, "closeTab");
    },
    async navigate(tab, url) {
      await withTimeout(tab.goto(url), timeoutMs, `goto ${url}`);
      await tab.playwright?.waitForLoadState?.({ state: waitUntil, timeoutMs }).catch(() => {});
    },
    async extractAccountVideos({ listTab, detailTab, account }) {
      const listResult = await readParsedSnapshot(listTab, (snapshot) => {
        const listStatus = classifyTikTokPage(snapshot);
        if (listStatus.status !== "ok") return listStatus;

        const videoLinks = parseTikTokProfileVideos(snapshot, {
          baseUrl: account.profileUrl,
          maxVideos: maxVideosPerAccount
        });
        if (!videoLinks.length) {
          return { status: "missing_metrics", reason: "public profile did not expose video links" };
        }
        return { status: "ok", videoLinks };
      }, { retries: snapshotRetries, retryDelayMs: snapshotRetryDelayMs, snapshotTimeoutMs });
      if (listResult.status !== "ok") return listResult;

      const videos = [];
      const failures = [];
      const readTab = detailTab ?? listTab;
      for (const link of listResult.videoLinks) {
        await client.navigate(readTab, link.videoUrl);
        const detail = await readParsedSnapshot(readTab, (snapshot) => parseTikTokVideoDetail(snapshot, {
          videoUrl: link.videoUrl,
          accountHandle: account.handle,
          currentUrl: getTabCurrentUrl(readTab)
        }), {
          retries: snapshotRetries,
          retryDelayMs: snapshotRetryDelayMs,
          snapshotTimeoutMs,
          shouldRetry: shouldRetryVideoMetrics
        });
        if (detail.status === "ok") {
          videos.push(detail.video);
        } else {
          failures.push({
            targetType: "video",
            targetName: account.handle,
            targetUrl: link.videoUrl,
            status: detail.status,
            reason: detail.reason
          });
        }
      }

      return { status: "ok", videos, failures };
    },
    async extractShopProducts({ listTab, shop }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokShopProducts(snapshot, {
        shopUrl: shop.shopUrl,
        shopName: shop.name,
        maxProducts: maxProductsPerShop
      }), { retries: snapshotRetries, retryDelayMs: snapshotRetryDelayMs, snapshotTimeoutMs });
    },
    async extractProfileShopRefs({ profileTab, account, pageUrl }) {
      return readParsedSnapshot(profileTab, (snapshot) => parseTikTokProfileShopRefs(snapshot, {
        handle: account.handle,
        profileUrl: pageUrl ?? getTabCurrentUrl(profileTab) ?? account.profileUrl,
        relatedBooks: account.relatedBooks ?? []
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        shouldRetry: shouldRetryProfileRefs
      });
    },
    async extractProfileVideos({ profileTab, account, maxVideos }) {
      return readParsedSnapshot(profileTab, (snapshot) => parseTikTokProfileVideos(snapshot, {
        baseUrl: account.profileUrl,
        maxVideos: maxVideos ?? maxVideosPerAccount
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        shouldRetry: shouldRetryProfileVideos
      });
    },
    async extractSearchResults({ listTab, query }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokSearchResults(snapshot, { query }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        shouldRetry: shouldRetrySearchResults
      });
    },
    async extractDirectVideo({ detailTab, video }) {
      return readParsedSnapshot(detailTab, (snapshot) => parseTikTokVideoDetail(snapshot, {
        videoUrl: video.videoUrl,
        accountHandle: video.accountHandle,
        currentUrl: getTabCurrentUrl(detailTab)
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        shouldRetry: shouldRetryVideoMetrics
      });
    }
  };

  return client;
}

export function parseTikTokProfileVideos(snapshot, { baseUrl = TIKTOK_ORIGIN, maxVideos = 6 } = {}) {
  const links = new Map();
  for (const video of parseTikTokProfileVideosFromHydration(snapshot, { maxVideos })) {
    links.set(video.videoUrl, video);
    if (links.size >= maxVideos) return [...links.values()];
  }

  const text = String(snapshot ?? "");
  const pattern = /(?:href=["']?|url\(["']?|^|\s)(https?:\/\/(?:www\.)?tiktok\.com\/@[^"'\s)<>]+\/video\/\d+|\/@[^"'\s)<>]+\/video\/\d+)/giu;
  for (const match of text.matchAll(pattern)) {
    const url = normalizeTikTokUrl(match[1], baseUrl);
    if (!url) continue;
    links.set(url, {
      videoUrl: url,
      views: extractGridViews(text, match.index ?? 0)
    });
    if (links.size >= maxVideos) break;
  }
  return [...links.values()];
}

export function parseTikTokVideoDetail(snapshot, { videoUrl, accountHandle, currentUrl } = {}) {
  const text = plainText(snapshot);
  const status = classifyTikTokPage(text);
  if (status.status !== "ok") return status;
  const hydration = parseTikTokHydrationData(snapshot);
  const structured = extractStructuredVideoDetail(hydration, { videoUrl, accountHandle, currentUrl });
  if (structured) {
    return {
      status: "ok",
      video: {
        ...structured,
        productRefs: extractProductRefs(snapshot, { baseUrl: structured.videoUrl ?? videoUrl })
      }
    };
  }

  const identity = extractVideoIdentity(text, { videoUrl, accountHandle, currentUrl });

  const views = findMetric(text, ["views", "view", "播放", "观看"]);
  const likes = findMetric(text, ["likes", "like", "赞"]);
  const comments = findMetric(text, ["comments", "comment", "评论"]);
  const shares = findMetric(text, ["shares", "share", "分享"]);
  const hasAnyMetric = [views, likes, comments, shares].some((value) => Number.isFinite(value) && value > 0);
  if (!hasAnyMetric) {
    return { status: "missing_metrics", reason: "public video page did not expose video metrics" };
  }

  return {
    status: "ok",
    video: {
      accountHandle: identity.accountHandle,
      videoUrl: identity.videoUrl,
      caption: extractCaption(text),
      postedAt: undefined,
      views: Number.isFinite(views) ? views : 0,
      likes: Number.isFinite(likes) ? likes : 0,
      comments: Number.isFinite(comments) ? comments : 0,
      shares: Number.isFinite(shares) ? shares : 0,
      productRefs: extractProductRefs(snapshot, { baseUrl: identity.videoUrl ?? videoUrl })
    }
  };
}

export function parseTikTokShopProducts(snapshot, { shopUrl = TIKTOK_ORIGIN, shopName = "", maxProducts = 6 } = {}) {
  const text = String(snapshot ?? "");
  const status = classifyTikTokPage(text);
  if (status.status !== "ok") return status;

  const links = new Map();
  const pattern = /(?:href=["']?|url\(["']?|^|\s)(https?:\/\/(?:www\.)?tiktok\.com\/shop\/(?:p|product|pdp)\/[^"'\s)<>]+|\/shop\/(?:p|product|pdp)\/[^"'\s)<>]+)/giu;
  for (const match of text.matchAll(pattern)) {
    const url = normalizeTikTokUrl(match[1], shopUrl);
    if (!url) continue;
    links.set(url, {
      shopName,
      productUrl: url,
      title: extractProductTitle(text, url),
      price: extractPrice(text),
      soldCount: findMetric(text, ["sold", "销量", "已售"]),
      reviewCount: findMetric(text, ["reviews", "review", "评价", "评论"]),
      rating: extractRating(text)
    });
    if (links.size >= maxProducts) break;
  }

  if (!links.size) {
    return { status: "missing_metrics", reason: "public shop page did not expose product data" };
  }
  return { status: "ok", products: [...links.values()] };
}

export function parseCompactNumber(value) {
  const raw = String(value ?? "").trim().replaceAll(",", "");
  const match = raw.match(/([\d.]+)\s*([KMB万億亿]?)/iu);
  if (!match) return NaN;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return NaN;
  const suffix = match[2]?.toUpperCase();
  const multiplier = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
    "万": 10_000,
    "億": 100_000_000,
    "亿": 100_000_000
  }[suffix] ?? 1;
  return Math.round(number * multiplier);
}

function classifyTikTokPage(snapshot) {
  const text = plainText(snapshot).toLowerCase();
  if (/log in to tiktok|login to tiktok|sign in to continue|登录/.test(text)) {
    return { status: "login_required", reason: "TikTok public page requires login for this data" };
  }
  if (
    /captcha|verification|unusual traffic|blocked|验证码|地区不可用/.test(text) ||
    /(?:not available|unavailable).{0,40}region|region.{0,40}(?:not available|unavailable)/.test(text)
  ) {
    return { status: "blocked", reason: "TikTok public page is blocked, region limited, or requires verification" };
  }
  return { status: "ok" };
}

function normalizeTikTokUrl(value, baseUrl) {
  const raw = String(value ?? "").replace(/^href=/u, "").replace(/^["']|["']$/gu, "");
  if (!raw) return "";
  if (raw.startsWith("http")) return raw.split("?")[0];
  if (raw.startsWith("/")) return `${TIKTOK_ORIGIN}${raw}`.split("?")[0];
  try {
    return new URL(raw, baseUrl).toString().split("?")[0];
  } catch {
    return "";
  }
}

function parseTikTokHydrationData(snapshot) {
  const raw = String(snapshot ?? "");
  const match = raw.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/iu
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseTikTokProfileVideosFromHydration(snapshot, { maxVideos = 6 } = {}) {
  const scope = parseTikTokHydrationData(snapshot)?.__DEFAULT_SCOPE__;
  const itemList = scope?.["webapp.user-detail"]?.userInfo?.itemList;
  if (!Array.isArray(itemList) || itemList.length === 0) return [];

  const videos = [];
  for (const item of itemList) {
    const video = toHydratedProfileVideo(item);
    if (!video) continue;
    videos.push(video);
    if (videos.length >= maxVideos) break;
  }
  return videos;
}

function toHydratedProfileVideo(item) {
  const itemStruct = item?.itemStruct ?? item;
  const authorHandle = itemStruct?.author?.uniqueId;
  const itemId = itemStruct?.id ?? itemStruct?.itemId;
  if (!authorHandle || !itemId) return null;
  const views = coerceMetricValue(itemStruct?.statsV2?.playCount ?? itemStruct?.stats?.playCount);
  return {
    videoUrl: `${TIKTOK_ORIGIN}/@${authorHandle}/video/${itemId}`,
    views: Number.isFinite(views) ? views : undefined
  };
}

function extractStructuredVideoDetail(hydration, { videoUrl, accountHandle, currentUrl } = {}) {
  const itemStruct = hydration?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!itemStruct) return null;

  const authorHandle = itemStruct.author?.uniqueId ?? accountHandle;
  const itemId = itemStruct.id;
  const canonicalUrl = authorHandle && itemId
    ? `${TIKTOK_ORIGIN}/@${authorHandle}/video/${itemId}`
    : extractVideoIdentity("", { videoUrl, accountHandle, currentUrl }).videoUrl;
  const stats = itemStruct.statsV2 ?? itemStruct.stats ?? {};
  const views = coerceMetricValue(stats.playCount);
  const likes = coerceMetricValue(stats.diggCount);
  const comments = coerceMetricValue(stats.commentCount);
  const shares = coerceMetricValue(stats.shareCount);
  const postedAt = normalizeTikTokTimestamp(itemStruct.createTime);

  if (![views, likes, comments, shares].some(Number.isFinite)) return null;

  return {
    accountHandle: authorHandle,
    videoUrl: canonicalUrl ?? videoUrl,
    caption: extractStructuredCaption(itemStruct),
    postedAt,
    views: Number.isFinite(views) ? views : 0,
    likes: Number.isFinite(likes) ? likes : 0,
    comments: Number.isFinite(comments) ? comments : 0,
    shares: Number.isFinite(shares) ? shares : 0
  };
}

function extractVideoIdentity(text, { videoUrl, accountHandle, currentUrl } = {}) {
  const normalized = plainText(text);
  const canonical = [currentUrl, videoUrl, normalized]
    .filter(Boolean)
    .join(" ")
    .match(/(?:https?:\/\/(?:www\.)?tiktok\.com)?\/@([A-Za-z0-9._-]+)\/video\/(\d+)/iu);
  if (!canonical) {
    return { videoUrl, accountHandle };
  }
  const handle = canonical[1];
  return {
    accountHandle: accountHandle ?? handle,
    videoUrl: `https://www.tiktok.com/@${handle}/video/${canonical[2]}`
  };
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function findMetric(text, labels) {
  const normalized = plainText(text);
  const candidates = [];
  for (const label of labels) {
    const before = new RegExp(`([\\d.,]+\\s*[KMB万億亿]?)\\s*(?:个|次|条|人)?\\s*${escapeRegExp(label)}`, "giu");
    const after = new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*([\\d.,]+\\s*[KMB万億亿]?)`, "giu");
    for (const match of normalized.matchAll(before)) {
      const value = parseCompactNumber(match[1]);
      if (Number.isFinite(value)) candidates.push({ value, index: match.index ?? Number.MAX_SAFE_INTEGER });
    }
    for (const match of normalized.matchAll(after)) {
      const value = parseCompactNumber(match[1]);
      if (Number.isFinite(value)) candidates.push({ value, index: match.index ?? Number.MAX_SAFE_INTEGER });
    }
  }
  if (!candidates.length) return NaN;
  candidates.sort((left, right) => left.index - right.index);
  return candidates.find((candidate) => candidate.value > 0)?.value ?? candidates[0].value;
}

function extractCaption(text) {
  const normalized = plainText(text);
  const explicit = normalized.match(/caption\s*[:：]\s*([^。.!?\n]+[。.!?]?)/iu);
  if (explicit) return explicit[1].trim();
  return "";
}

function extractStructuredCaption(itemStruct) {
  const primary = plainText(itemStruct?.desc ?? "");
  if (primary) return primary;
  const contentDescriptions = Array.isArray(itemStruct?.contents)
    ? itemStruct.contents
        .map((entry) => plainText(entry?.desc ?? ""))
        .filter(Boolean)
    : [];
  return contentDescriptions.join(" ").trim();
}

function extractProductTitle(text, productUrl) {
  const slug = productUrl.split("/").filter(Boolean).at(-1) ?? "product";
  const nearby = String(text ?? "").match(new RegExp(`>([^<>]{3,120})<[^<>]+href=["']?[^"']*${escapeRegExp(slug)}`, "iu"));
  if (nearby) return plainText(nearby[1]);
  const anchorText = String(text ?? "").match(new RegExp(`href=["']?[^"']*${escapeRegExp(slug)}[^>]*>([^<>]{3,120})<`, "iu"));
  if (anchorText) return plainText(anchorText[1]);
  return slug.replace(/[-_]+/gu, " ");
}

function extractGridViews(text, index) {
  const segment = String(text ?? "").slice(index, index + 260);
  const views = findMetric(segment, ["views", "view", "播放", "观看"]);
  return Number.isFinite(views) ? views : undefined;
}

function extractProductRefs(snapshot, { baseUrl = TIKTOK_ORIGIN } = {}) {
  const text = String(snapshot ?? "");
  const refs = new Map();
  const productPattern = /(?:https?:\/\/(?:www\.)?tiktok\.com)?\/shop\/(?:p|product|pdp)\/[^\s"'<>）)]+/giu;
  const shopPattern = /(?:https?:\/\/(?:www\.)?tiktok\.com)?\/shop\/(?!p\/|product\/|pdp\/)[^\s"'<>）)]+/giu;
  for (const match of text.matchAll(productPattern)) {
    const productUrl = normalizeTikTokUrl(match[0], baseUrl);
    refs.set(productUrl, { productUrl });
  }
  for (const match of text.matchAll(shopPattern)) {
    const shopUrl = normalizeTikTokUrl(match[0], baseUrl);
    refs.set(shopUrl, { shopUrl, shopName: titleFromShopUrl(shopUrl) });
  }
  return [...refs.values()];
}

function titleFromShopUrl(url) {
  return (String(url ?? "").split("/").filter(Boolean).at(-1) ?? "TikTok Shop").replace(/[-_]+/gu, " ");
}

function extractPrice(text) {
  const match = plainText(text).match(/[$￥]\s*([\d.]+)/u);
  return match ? Number(match[1]) : 0;
}

function extractRating(text) {
  const match = plainText(text).match(/(?:rating|评分)\s*[:：]?\s*(\d(?:\.\d)?)/iu);
  return match ? Number(match[1]) : 0;
}

function coerceMetricValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseCompactNumber(value);
  return NaN;
}

function normalizeTikTokTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const epochMs = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  return new Date(epochMs).toISOString();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function getTabCurrentUrl(tab) {
  return tab?.url ?? tab?.currentUrl;
}

async function readParsedSnapshot(tab, parse, { retries, retryDelayMs, snapshotTimeoutMs, shouldRetry = shouldRetryMissingMetrics }) {
  let latest = { status: "missing_metrics", reason: "public page did not expose data" };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    latest = parse(await withTimeout(tab.playwright.domSnapshot(), snapshotTimeoutMs, "domSnapshot"));
    if (!shouldRetry(latest)) return latest;
    if (attempt < retries) await delay(retryDelayMs);
  }
  return latest;
}

function shouldRetryMissingMetrics(result) {
  return result?.status === "missing_metrics";
}

function shouldRetryVideoMetrics(result) {
  if (result?.status === "missing_metrics") return true;
  const video = result?.video;
  return (
    result?.status === "ok" &&
    Number(video?.shares ?? 0) > 0 &&
    Number(video?.likes ?? 0) === 0 &&
    Number(video?.comments ?? 0) === 0
  );
}

function shouldRetrySearchResults(result) {
  return !result?.accounts?.length && !result?.videos?.length && !result?.shops?.length;
}

function shouldRetryProfileRefs(result) {
  return Array.isArray(result) && result.length === 0;
}

function shouldRetryProfileVideos(result) {
  return Array.isArray(result) && result.length === 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, operationName) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`chrome_operation_timeout: ${operationName} exceeded ${timeout}ms`));
    }, timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}
