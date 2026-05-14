import {
  parseTikTokProfileVideos,
  parseTikTokShopProducts,
  parseTikTokVideoDetail
} from "./chrome-plugin-bridge.mjs";
import { parseTikTokProfileShopRefs, parseTikTokSearchResults } from "./discovery.mjs";

export function createPlaywrightBrowserClient({
  context,
  waitUntil = "domcontentloaded",
  timeoutMs = 15_000,
  snapshotTimeoutMs = timeoutMs,
  closeTimeoutMs = 5_000,
  snapshotRetries = 8,
  snapshotRetryDelayMs = 1_000,
  maxVideosPerAccount = 6,
  maxProductsPerShop = 6
} = {}) {
  if (!context?.newPage) {
    throw new Error("playwright_context_unavailable: context.newPage is required");
  }

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
    },
    async extractAccountVideos({ listTab, detailTab, account }) {
      const listResult = await readParsedSnapshot(listTab, (snapshot) => {
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
        snapshotTimeoutMs
      });
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
    },
    async extractSearchResults({ listTab, query }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokSearchResults(snapshot, { query }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs,
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
    async extractShopProducts({ listTab, shop }) {
      return readParsedSnapshot(listTab, (snapshot) => parseTikTokShopProducts(snapshot, {
        shopUrl: shop.shopUrl,
        shopName: shop.name,
        maxProducts: maxProductsPerShop
      }), {
        retries: snapshotRetries,
        retryDelayMs: snapshotRetryDelayMs,
        snapshotTimeoutMs
      });
    }
  };

  return client;
}

function wrapPage(page) {
  return {
    id: page.guid ?? `page-${Date.now()}`,
    get url() {
      return page.url;
    },
    get currentUrl() {
      return page.url;
    },
    playwright: {
      async domSnapshot() {
        return page.content();
      },
      async waitForLoadState({ state, timeoutMs }) {
        return page.waitForLoadState(state, { timeout: timeoutMs });
      }
    },
    async goto(url) {
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
  { retries, retryDelayMs, snapshotTimeoutMs, shouldRetry = shouldRetryMissingMetrics }
) {
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

function getTabCurrentUrl(tab) {
  return tab?.url ?? tab?.currentUrl;
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
