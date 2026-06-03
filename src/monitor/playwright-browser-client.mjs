import {
  parseTikTokProfileVideos,
  parseTikTokShopProducts,
  parseTikTokVideoDetail
} from "./chrome-plugin-bridge.mjs";
import {
  buildTikTokSearchUrl,
  parseTikTokProfileShopRefs,
  parseTikTokSearchResults
} from "./discovery.mjs";
import { isLikelyTikTokVideoId } from "./video-time.mjs";

export function createPlaywrightBrowserClient({
  context,
  waitUntil = "domcontentloaded",
  timeoutMs = 15_000,
  snapshotTimeoutMs = timeoutMs,
  closeTimeoutMs = 5_000,
  snapshotRetries = 8,
  snapshotRetryDelayMs = 1_000,
  maxVideosPerAccount = 6,
  maxProductsPerShop = 6,
  humanize = false,
  humanPreset = "careful",
  postNavigateDelayMinMs,
  postNavigateDelayMaxMs,
  preSnapshotDelayMinMs,
  preSnapshotDelayMaxMs,
  preSnapshotScrollMinY,
  preSnapshotScrollMaxY
} = {}) {
  if (!context?.newPage) {
    throw new Error("playwright_context_unavailable: context.newPage is required");
  }

  const humanizedSettings = resolveHumanizedSettings({
    enabled: humanize,
    humanPreset,
    postNavigateDelayMinMs,
    postNavigateDelayMaxMs,
    preSnapshotDelayMinMs,
    preSnapshotDelayMaxMs,
    preSnapshotScrollMinY,
    preSnapshotScrollMaxY
  });

  const client = {
    usesDetailTab: true,
    async createTab() {
      return wrapPage(await context.newPage());
    },
    async closeTab(tab) {
      if (tab?.close) await withTimeout(tab.close(), closeTimeoutMs, "closeTab");
    },
    async navigate(tab, url) {
      await withTimeout(tab.goto(url), timeoutMs, `goto ${url}`);
      await tab.playwright.waitForLoadState({ state: waitUntil, timeoutMs }).catch(() => {});
      await applyPostNavigateHumanization(tab, humanizedSettings);
    },
    async extractAccountVideos({ listTab, detailTab, account }) {
      let listResult = await readParsedSnapshot(listTab, (snapshot) => {
        const videoLinks = parseTikTokProfileVideos(snapshot, {
          baseUrl: account.profileUrl,
          maxVideos: maxVideosPerAccount
        });
        if (!videoLinks.length) {
          return { status: "missing_metrics", reason: "public profile did not expose video links" };
        }
        return { status: "ok", videoLinks };
      }, {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(listTab, humanizedSettings, attempt)
      });
      const capturedVideos = extractProfileVideosFromCapturedResponses(listTab, {
        account,
        maxVideos: maxVideosPerAccount
      });
      if (capturedVideos.length) {
        return { status: "ok", videos: capturedVideos, failures: [] };
      }
      if (shouldFallbackToSearchDiscovery(listResult)) {
        const fallback = await discoverAccountVideosFromSearch({
          browserClient: client,
          listTab,
          account,
          maxVideos: maxVideosPerAccount,
          humanizedSettings
        });
        if (fallback.status === "ok" && fallback.videoLinks.length) {
          listResult = fallback;
        }
      }
      if (listResult.status !== "ok") return listResult;

      const videos = [];
      const failures = [];
      const readTab = detailTab ?? listTab;
      for (const link of listResult.videoLinks) {
        await client.navigate(readTab, link.videoUrl);
        const detail = resolveVideoDetailDocumentFallback(readTab, await readParsedSnapshot(readTab, (snapshot) => parseTikTokVideoDetail(snapshot, {
          videoUrl: link.videoUrl,
          accountHandle: account.handle,
          currentUrl: getTabCurrentUrl(readTab)
        }), {
          retries: snapshotRetries,
          retryDelayMs: snapshotRetryDelayMs,
          snapshotTimeoutMs,
          beforeSnapshot: (attempt) => applyPreSnapshotHumanization(readTab, humanizedSettings, attempt),
          shouldRetry: shouldRetryVideoMetrics
        }), {
          videoUrl: link.videoUrl,
          accountHandle: account.handle,
          currentUrl: getTabCurrentUrl(readTab)
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
    async extractDirectVideo({ detailTab, video }) {
      return resolveVideoDetailDocumentFallback(detailTab, await readParsedSnapshot(detailTab, (snapshot) => parseTikTokVideoDetail(snapshot, {
        videoUrl: video.videoUrl,
        accountHandle: video.accountHandle,
        currentUrl: getTabCurrentUrl(detailTab)
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(detailTab, humanizedSettings, attempt),
        shouldRetry: shouldRetryVideoMetrics
      }), {
        videoUrl: video.videoUrl,
        accountHandle: video.accountHandle,
        currentUrl: getTabCurrentUrl(detailTab)
      });
    },
    async extractSearchResults({ listTab, query }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokSearchResults(snapshot, { query }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(listTab, humanizedSettings, attempt),
        shouldRetry: shouldRetrySearchResults
      });
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
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(profileTab, humanizedSettings, attempt),
        shouldRetry: shouldRetryProfileRefs
      });
    },
    async extractProfileVideos({ profileTab, account, maxVideos }) {
      let listResult = await readParsedSnapshot(profileTab, (snapshot) => parseTikTokProfileVideos(snapshot, {
        baseUrl: account.profileUrl,
        maxVideos: maxVideos ?? maxVideosPerAccount
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(profileTab, humanizedSettings, attempt),
        shouldRetry: shouldRetryProfileVideos
      });
      const capturedVideos = extractProfileVideosFromCapturedResponses(profileTab, {
        account,
        maxVideos: maxVideos ?? maxVideosPerAccount
      });
      if (capturedVideos.length) {
        return {
          status: "ok",
          videoLinks: capturedVideos.map((video) => ({
            videoUrl: video.videoUrl,
            views: Number(video.views ?? 0)
          })),
          videos: capturedVideos
        };
      }
      if (Array.isArray(listResult) && listResult.length) {
        return {
          status: "ok",
          videoLinks: listResult,
          videos: []
        };
      }
      if (shouldFallbackToSearchDiscovery(listResult)) {
        const fallback = await discoverAccountVideosFromSearch({
          browserClient: client,
          listTab: profileTab,
          account,
          maxVideos: maxVideos ?? maxVideosPerAccount,
          humanizedSettings
        });
        if (fallback.status === "ok" && fallback.videoLinks.length) {
          listResult = fallback;
        }
      }
      if (Array.isArray(listResult)) {
        return {
          status: "ok",
          videoLinks: listResult,
          videos: []
        };
      }
      return listResult;
    },
    async extractShopProducts({ listTab, shop }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokShopProducts(snapshot, {
        shopUrl: shop.shopUrl,
        shopName: shop.name,
        maxProducts: maxProductsPerShop
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
        beforeSnapshot: (attempt) => applyPreSnapshotHumanization(listTab, humanizedSettings, attempt)
      });
    }
  };

  return client;
}

async function discoverAccountVideosFromSearch({
  browserClient,
  listTab,
  account,
  maxVideos,
  humanizedSettings
}) {
  const queries = buildAccountSearchQueries(account);
  const links = new Map();
  let lastFailure = null;

  for (const query of queries) {
    await browserClient.navigate(listTab, buildTikTokSearchUrl(query));
    const parsed = await readParsedSnapshot(listTab, (snapshot) => parseTikTokSearchResults(snapshot, { query }), {
      retries: 2,
      retryDelayMs: 400,
      snapshotTimeoutMs: 10_000,
      beforeSnapshot: (attempt) => applyPreSnapshotHumanization(listTab, humanizedSettings, attempt),
      shouldRetry: shouldRetrySearchResults
    });

    if (!parsed?.accounts && !parsed?.videos) {
      lastFailure = parsed;
      continue;
    }

    const matchingVideos = collectSearchVideoLinks(parsed, account.handle, maxVideos);
    for (const video of matchingVideos) {
      links.set(video.videoUrl, video);
      if (links.size >= maxVideos) {
        return { status: "ok", videoLinks: [...links.values()] };
      }
    }
  }

  if (links.size) {
    return { status: "ok", videoLinks: [...links.values()] };
  }

  return lastFailure ?? { status: "missing_metrics", reason: "search fallback did not expose account video links" };
}

function buildAccountSearchQueries(account) {
  const handle = normalizeHandle(account?.handle);
  if (!handle) return [];
  return [...new Set([`@${handle}`, handle])];
}

function collectSearchVideoLinks(parsed, handle, maxVideos) {
  const normalizedHandle = normalizeHandle(handle);
  const links = new Map();

  for (const video of parsed.videos ?? []) {
    if (normalizeHandle(video.handle) !== normalizedHandle || !video.videoUrl) continue;
    links.set(video.videoUrl, { videoUrl: video.videoUrl, views: undefined });
    if (links.size >= maxVideos) return [...links.values()];
  }

  for (const account of parsed.accounts ?? []) {
    if (normalizeHandle(account.handle) !== normalizedHandle) continue;
    for (const videoUrl of account.evidenceUrls ?? []) {
      links.set(videoUrl, { videoUrl, views: undefined });
      if (links.size >= maxVideos) return [...links.values()];
    }
  }

  return [...links.values()];
}

function shouldFallbackToSearchDiscovery(result) {
  if (!result || result.status === "ok") return false;
  return result.status === "missing_metrics" || result.status === "login_required";
}

function normalizeHandle(value) {
  return String(value ?? "").trim().replace(/^@/u, "").toLowerCase();
}

function wrapPage(page) {
  const capturedResponses = [];
  let capturedDocumentHtml = "";
  page.on?.("response", async (response) => {
    const url = typeof response?.url === "function" ? response.url() : response?.url;
    const headers = typeof response?.allHeaders === "function" ? await response.allHeaders().catch(() => ({})) : {};
    const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "";
    try {
      const text = typeof response?.text === "function"
        ? await response.text()
        : typeof response?.body === "string"
          ? response.body
          : "";
      if (!text) return;
      if (/text\/html/iu.test(contentType)) {
        capturedDocumentHtml = text;
      }
      if (!/\/api\/post\/item_list\//iu.test(String(url ?? ""))) return;
      capturedResponses.push({ url, body: JSON.parse(text) });
      if (capturedResponses.length > 12) capturedResponses.shift();
    } catch {
      // Ignore malformed or empty response bodies.
    }
  });
  return {
    id: page.guid ?? `page-${Date.now()}`,
    get url() {
      return page.url;
    },
    get currentUrl() {
      return page.url;
    },
    async scrollBy(y = 0) {
      const deltaY = Number(y);
      if (!Number.isFinite(deltaY) || deltaY === 0) return;
      if (page.mouse?.wheel) {
        await page.mouse.wheel(0, deltaY);
        return;
      }
      if (page.evaluate) {
        await page.evaluate((value) => window.scrollBy(0, value), deltaY);
      }
    },
    playwright: {
      async domSnapshot() {
        return page.content();
      },
      async waitForLoadState({ state, timeoutMs }) {
        return page.waitForLoadState(state, { timeout: timeoutMs });
      }
    },
    getCapturedResponses() {
      return [...capturedResponses];
    },
    getCapturedDocumentHtml() {
      return capturedDocumentHtml;
    },
    async goto(url) {
      capturedResponses.length = 0;
      capturedDocumentHtml = "";
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
    },
    async close() {
      await page.close();
    }
  };
}

async function readParsedSnapshot(
  tab,
  parse,
  { retries, retryDelayMs, snapshotTimeoutMs, shouldRetry = shouldRetryMissingMetrics, beforeSnapshot }
) {
  let latest = { status: "missing_metrics", reason: "public page did not expose data" };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (beforeSnapshot) await beforeSnapshot(attempt);
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

function resolveVideoDetailDocumentFallback(tab, primaryResult, { videoUrl, accountHandle, currentUrl } = {}) {
  if (primaryResult?.status === "ok") return primaryResult;
  const documentHtml = tab?.getCapturedDocumentHtml?.();
  if (!documentHtml) return primaryResult;
  const fallback = parseTikTokVideoDetail(documentHtml, {
    videoUrl,
    accountHandle,
    currentUrl
  });
  return fallback?.status === "ok" ? fallback : primaryResult;
}

function extractProfileVideosFromCapturedResponses(tab, { account, maxVideos }) {
  const responses = tab?.getCapturedResponses?.() ?? [];
  if (!responses.length) return [];

  const normalizedHandle = normalizeHandle(account?.handle);
  const videos = new Map();
  for (const response of responses) {
    const candidates = collectVideoCandidates(response.body, normalizedHandle);
    for (const video of candidates) {
      if (videos.has(video.videoUrl)) continue;
      videos.set(video.videoUrl, video);
      if (videos.size >= maxVideos) {
        return [...videos.values()];
      }
    }
  }
  return [...videos.values()];
}

function collectVideoCandidates(value, normalizedHandle, inheritedHandle, sink = new Map()) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectVideoCandidates(entry, normalizedHandle, inheritedHandle, sink);
    }
    return [...sink.values()];
  }
  if (!value || typeof value !== "object") {
    return [...sink.values()];
  }

  const objectHandle = normalizeHandle(
    value.author?.uniqueId ??
    value.author?.unique_id ??
    value.authorInfo?.uniqueId ??
    inheritedHandle
  );
  const itemId = stringifyVideoId(value.id ?? value.itemId ?? value.item_id);
  const looksLikeVideoRecord = Boolean(
    itemId &&
    (value.createTime || value.create_time || value.stats || value.statsV2 || value.desc || value.video || value.imagePost)
  );
  if (looksLikeVideoRecord) {
    const handleForUrl = objectHandle || normalizedHandle;
    if (handleForUrl && (!normalizedHandle || handleForUrl === normalizedHandle)) {
      const videoUrl = `https://www.tiktok.com/@${handleForUrl}/video/${itemId}`;
      if (!sink.has(videoUrl)) {
        sink.set(videoUrl, {
          accountHandle: handleForUrl,
          videoUrl,
          caption: String(value.desc ?? "").trim(),
          postedAt: coerceTimestamp(value.createTime ?? value.create_time),
          views: coerceMetricValue(value.statsV2?.playCount ?? value.stats?.playCount) ?? 0,
          likes: coerceMetricValue(value.statsV2?.diggCount ?? value.stats?.diggCount) ?? 0,
          comments: coerceMetricValue(value.statsV2?.commentCount ?? value.stats?.commentCount) ?? 0,
          shares: coerceMetricValue(value.statsV2?.shareCount ?? value.stats?.shareCount) ?? 0,
          productRefs: []
        });
      }
    }
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== "object") continue;
    collectVideoCandidates(nested, normalizedHandle, objectHandle || inheritedHandle, sink);
  }
  return [...sink.values()];
}

function stringifyVideoId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(Math.trunc(value));
    return isLikelyTikTokVideoId(text) ? text : "";
  }
  const text = String(value ?? "").trim();
  return isLikelyTikTokVideoId(text) ? text : "";
}

function coerceMetricValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim().replaceAll(",", "");
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function coerceTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return new Date(number * 1000).toISOString();
}

function getTabCurrentUrl(tab) {
  return tab?.url ?? tab?.currentUrl;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveHumanizedSettings({
  enabled,
  humanPreset,
  postNavigateDelayMinMs,
  postNavigateDelayMaxMs,
  preSnapshotDelayMinMs,
  preSnapshotDelayMaxMs,
  preSnapshotScrollMinY,
  preSnapshotScrollMaxY
}) {
  const presetDefaults = humanPreset === "slow"
    ? {
        postNavigateDelayMinMs: 1800,
        postNavigateDelayMaxMs: 3600,
        preSnapshotDelayMinMs: 1200,
        preSnapshotDelayMaxMs: 2400,
        preSnapshotScrollMinY: 320,
        preSnapshotScrollMaxY: 920
      }
    : {
        postNavigateDelayMinMs: 1200,
        postNavigateDelayMaxMs: 2600,
        preSnapshotDelayMinMs: 900,
        preSnapshotDelayMaxMs: 1800,
        preSnapshotScrollMinY: 240,
        preSnapshotScrollMaxY: 720
      };
  return {
    enabled: Boolean(enabled),
    postNavigateDelayMinMs: numberOr(postNavigateDelayMinMs, presetDefaults.postNavigateDelayMinMs),
    postNavigateDelayMaxMs: numberOr(postNavigateDelayMaxMs, presetDefaults.postNavigateDelayMaxMs),
    preSnapshotDelayMinMs: numberOr(preSnapshotDelayMinMs, presetDefaults.preSnapshotDelayMinMs),
    preSnapshotDelayMaxMs: numberOr(preSnapshotDelayMaxMs, presetDefaults.preSnapshotDelayMaxMs),
    preSnapshotScrollMinY: numberOr(preSnapshotScrollMinY, presetDefaults.preSnapshotScrollMinY),
    preSnapshotScrollMaxY: numberOr(preSnapshotScrollMaxY, presetDefaults.preSnapshotScrollMaxY)
  };
}

async function applyPostNavigateHumanization(tab, settings) {
  if (!settings.enabled) return;
  await delay(randomBetween(settings.postNavigateDelayMinMs, settings.postNavigateDelayMaxMs));
}

async function applyPreSnapshotHumanization(tab, settings, attempt) {
  if (!settings.enabled) return;
  if (attempt === 0) {
    await tab.scrollBy?.(randomBetween(settings.preSnapshotScrollMinY, settings.preSnapshotScrollMaxY));
  }
  await delay(randomBetween(settings.preSnapshotDelayMinMs, settings.preSnapshotDelayMaxMs));
}

function randomBetween(min, max) {
  const lower = numberOr(min, 0);
  const upper = numberOr(max, lower);
  if (upper <= lower) return lower;
  return Math.floor(lower + Math.random() * (upper - lower + 1));
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
