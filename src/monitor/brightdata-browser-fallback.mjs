import { createPlaywrightBrowserClient } from "./playwright-browser-client.mjs";

export async function createBrightDataFallbackHooks(config = {}) {
  const endpoint = resolveBrightDataBrowserEndpoint(config);
  if (!endpoint) {
    throw new Error("Bright Data Browser API credentials are not configured");
  }

  return {
    extractProfileVideosFallback: async ({ account, primaryResult }) => {
      if (!shouldAttemptProfileFallback(primaryResult)) {
        return primaryResult;
      }
      return withBrightDataBrowserClient({
        config,
        async run(browserClient) {
          const profileTab = await browserClient.createTab();
          try {
            await browserClient.navigate(profileTab, account.profileUrl);
            return await browserClient.extractProfileVideos({
              profileTab,
              account,
              maxVideos: Number(config.maxVideosPerAccount ?? 120)
            });
          } finally {
            await browserClient.closeTab(profileTab);
          }
        }
      });
    },
    extractDirectVideoFallback: async ({ video, primaryResult }) => {
      if (!shouldAttemptVideoFallback(primaryResult)) {
        return primaryResult;
      }
      return withBrightDataBrowserClient({
        config,
        async run(browserClient) {
          const detailTab = await browserClient.createTab();
          try {
            await browserClient.navigate(detailTab, video.videoUrl);
            return await browserClient.extractDirectVideo({
              detailTab,
              video
            });
          } finally {
            await browserClient.closeTab(detailTab);
          }
        }
      });
    }
  };
}

export function resolveBrightDataBrowserEndpoint(config = {}) {
  const explicitEndpoint = String(config.brightDataBrowserWsEndpoint ?? "").trim();
  if (explicitEndpoint) return explicitEndpoint;

  const auth = String(config.brightDataBrowserAuth ?? "").trim();
  if (!auth) return "";
  return `wss://${auth}@brd.superproxy.io:9222`;
}

export async function withBrightDataBrowserClient({
  config = {},
  run
} = {}) {
  const endpoint = resolveBrightDataBrowserEndpoint(config);
  if (!endpoint) {
    throw new Error("Bright Data Browser API credentials are not configured");
  }

  const playwright = await resolvePlaywrightModule(config);
  const browser = await playwright.chromium.connectOverCDP(endpoint, {
    timeout: Number(config.brightDataConnectTimeoutMs ?? 30_000)
  });

  let context = browser.contexts?.()[0];
  if (!context && typeof browser.newContext === "function") {
    context = await browser.newContext();
  }
  if (!context) {
    await browser.close?.();
    throw new Error("Bright Data Browser API did not expose a browser context");
  }

  const browserClient = (config.createPlaywrightBrowserClient ?? createPlaywrightBrowserClient)({
    context,
    maxVideosPerAccount: Number(config.maxVideosPerAccount ?? 120),
    maxProductsPerShop: Number(config.maxProductsPerShop ?? 6),
    waitUntil: config.waitUntil ?? "domcontentloaded",
    timeoutMs: Number(config.brightDataTimeoutMs ?? 30_000),
    snapshotTimeoutMs: Number(config.brightDataSnapshotTimeoutMs ?? config.brightDataTimeoutMs ?? 30_000),
    closeTimeoutMs: Number(config.closeTimeoutMs ?? 5_000),
    snapshotRetries: Number(config.brightDataSnapshotRetries ?? 3),
    snapshotRetryDelayMs: Number(config.brightDataSnapshotRetryDelayMs ?? 1_000),
    humanize: false
  });

  try {
    return await run(browserClient);
  } finally {
    await browser.close?.();
  }
}

async function resolvePlaywrightModule(config = {}) {
  if (config.brightDataPlaywright?.chromium?.connectOverCDP) {
    return config.brightDataPlaywright;
  }
  return import("playwright");
}

function shouldAttemptProfileFallback(primaryResult) {
  return primaryResult?.status === "login_required" || primaryResult?.status === "missing_metrics";
}

function shouldAttemptVideoFallback(primaryResult) {
  return primaryResult?.status === "login_required" || primaryResult?.status === "missing_metrics";
}
