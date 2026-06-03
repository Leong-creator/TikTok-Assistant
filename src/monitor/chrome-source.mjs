import { ChromeTabLedger } from "./tab-ledger.mjs";
import { normalizeTikTokVideoPostedAt } from "./video-time.mjs";

export async function collectChromeSnapshots({
  now = new Date(),
  maxTabs = 2,
  browserClient,
  accounts = [],
  shops = [],
  videos = [],
  config = {}
} = {}) {
  if (!browserClient) {
    throw new Error("chrome_unavailable: browserClient is required for chrome collection");
  }

  const ledger = new ChromeTabLedger({ browser: browserClient, maxTabs });
  const collectedAt = new Date(now).toISOString();
  const videoSnapshots = [];
  const productSnapshots = [];
  const failures = [];
  const processed = {
    videoTargets: 0,
    accountTargets: 0,
    shopTargets: 0
  };
  let recycleRequested = false;
  let stopReason = null;
  let consecutiveLoginRequired = 0;
  let consecutiveNavigationFailures = 0;
  let consecutiveShallowContent = 0;
  let detailAttempts = 0;
  let detailSuccesses = 0;
  const videoOnlyBatch = accounts.length === 0 && shops.length === 0;

  try {
    for (const video of videos.filter((item) => item.enabled !== false)) {
      let detailTab;
      try {
        detailTab = await ledger.acquire("video-detail");
        await browserClient.navigate(detailTab, video.videoUrl);
        const response = await extractDirectVideo({ browserClient, detailTab, video, config });
        if (response.status && response.status !== "ok") {
          failures.push(buildFailure({ targetType: "video", target: video, response }));
          processed.videoTargets += 1;
          detailAttempts += 1;
          ({
            consecutiveLoginRequired,
            consecutiveNavigationFailures,
            consecutiveShallowContent
          } = updateFailureStreaks({
            response,
            failure: failures.at(-1),
            state: {
              consecutiveLoginRequired,
              consecutiveNavigationFailures,
              consecutiveShallowContent
            }
          }));
          if (videoOnlyBatch) {
            const recycleDecision = shouldRequestRecycle({
              config,
              consecutiveLoginRequired,
              consecutiveNavigationFailures,
              consecutiveShallowContent,
              detailAttempts,
              detailSuccesses
            });
            if (recycleDecision) {
              recycleRequested = true;
              stopReason = recycleDecision;
              break;
            }
          }
          continue;
        }
        videoSnapshots.push(normalizeVideoSnapshot({
          collectedAt,
          account: { handle: video.accountHandle },
          video: response.video
        }));
        processed.videoTargets += 1;
        detailAttempts += 1;
        detailSuccesses += 1;
        consecutiveLoginRequired = 0;
        consecutiveNavigationFailures = 0;
        consecutiveShallowContent = 0;
      } catch (error) {
        const failure = buildFailure({ targetType: "video", target: video, response: classifyError(error) });
        failures.push(failure);
        processed.videoTargets += 1;
        detailAttempts += 1;
        ({
          consecutiveLoginRequired,
          consecutiveNavigationFailures,
          consecutiveShallowContent
        } = updateFailureStreaks({
          response: failure,
          failure,
          state: {
            consecutiveLoginRequired,
            consecutiveNavigationFailures,
            consecutiveShallowContent
          }
        }));
        if (videoOnlyBatch) {
          const recycleDecision = shouldRequestRecycle({
            config,
            consecutiveLoginRequired,
            consecutiveNavigationFailures,
            consecutiveShallowContent,
            detailAttempts,
            detailSuccesses
          });
          if (recycleDecision) {
            recycleRequested = true;
            stopReason = recycleDecision;
            break;
          }
        }
      } finally {
        if (detailTab) await ledger.release(detailTab.id);
      }
    }

    if (!recycleRequested) {
      for (const account of accounts.filter((item) => item.enabled !== false)) {
      let listTab;
      let detailTab;
      try {
        listTab = await ledger.acquire("account-list");
        detailTab = browserClient.usesDetailTab && maxTabs > 1 ? await ledger.acquire("video-detail") : undefined;
        await browserClient.navigate(listTab, account.profileUrl);
        const profileVideosResponse = await extractProfileVideos({ browserClient, profileTab: listTab, account, config });
        const profileVideos = normalizeProfileVideosResult(profileVideosResponse);
        if (profileVideos.status && profileVideos.status !== "ok") {
          failures.push(buildFailure({ targetType: "account", target: account, response: profileVideos }));
          continue;
        }
        const knownVideoMap = new Map(
          (account.knownVideos ?? [])
            .filter((item) => item?.videoUrl)
            .map((item) => [String(item.videoUrl).trim(), item])
        );
        const preloadedVideosByUrl = new Map(
          (profileVideos.videos ?? [])
            .filter((item) => item?.videoUrl)
            .map((item) => [String(item.videoUrl).trim(), item])
        );
        const readTab = detailTab ?? listTab;

        for (const link of profileVideos.videoLinks ?? []) {
          const previous = knownVideoMap.get(String(link.videoUrl ?? "").trim());
          const preloadedVideo = preloadedVideosByUrl.get(String(link.videoUrl ?? "").trim());
          if (preloadedVideo) {
            videoSnapshots.push(normalizeVideoSnapshot({ collectedAt, account, video: preloadedVideo }));
            continue;
          }
          if (shouldSkipDetailRefresh({ profileVideo: link, previous, viewDeltaThreshold: Number(config.profileViewDeltaThreshold ?? 1000) })) {
            videoSnapshots.push(
              normalizeVideoSnapshot({
                collectedAt,
                account,
                video: synthesizeHomepageSnapshot({ account, profileVideo: link, previous })
              })
            );
            continue;
          }

          await browserClient.navigate(readTab, link.videoUrl);
          const response = await extractDirectVideo({
            browserClient,
            detailTab: readTab,
            video: { videoUrl: link.videoUrl, accountHandle: account.handle },
            config
          });
          if (response.status && response.status !== "ok") {
            failures.push(buildFailure({
              targetType: "video",
              target: { id: `${account.id ?? account.handle}:${link.videoUrl}`, accountHandle: account.handle, videoUrl: link.videoUrl },
              response
            }));
            continue;
          }
          videoSnapshots.push(normalizeVideoSnapshot({ collectedAt, account, video: response.video }));
        }
      } catch (error) {
        failures.push(buildFailure({ targetType: "account", target: account, response: classifyError(error) }));
      } finally {
        processed.accountTargets += 1;
        if (detailTab) await ledger.release(detailTab.id);
        if (listTab) await ledger.release(listTab.id);
      }
      }
    }

    if (!recycleRequested) {
      for (const shop of shops.filter((item) => item.enabled !== false)) {
      let listTab;
      let detailTab;
      try {
        listTab = await ledger.acquire("shop-detail");
        detailTab = browserClient.usesDetailTab && maxTabs > 1 ? await ledger.acquire("product-detail") : undefined;
        await browserClient.navigate(listTab, shop.shopUrl);
        const response = await extractShopProducts({ browserClient, listTab, detailTab, shop });
        if (response.status && response.status !== "ok") {
          failures.push(buildFailure({ targetType: "shop", target: shop, response }));
          continue;
        }
        failures.push(...(response.failures ?? []));
        for (const product of response.products ?? []) {
          productSnapshots.push(normalizeProductSnapshot({ collectedAt, shop, product }));
        }
      } catch (error) {
        failures.push(buildFailure({ targetType: "shop", target: shop, response: classifyError(error) }));
      } finally {
        processed.shopTargets += 1;
        if (detailTab) await ledger.release(detailTab.id);
        if (listTab) await ledger.release(listTab.id);
      }
      }
    }
  } finally {
    await ledger.cleanup();
  }

  return {
    source: "chrome",
    collectedAt,
    videoSnapshots,
    productSnapshots,
    failures,
    processed,
    recycleRequested,
    stopReason
  };
}

async function extractAccountVideos({ browserClient, listTab, detailTab, account }) {
  if (browserClient.extractAccountVideos.length >= 2) {
    return browserClient.extractAccountVideos(listTab, account);
  }
  return browserClient.extractAccountVideos({ listTab, detailTab, account });
}

async function extractProfileVideos({ browserClient, profileTab, account, config = {} }) {
  if (typeof browserClient.extractProfileVideos === "function") {
    const result = await browserClient.extractProfileVideos({ profileTab, account });
    return runProfileVideosFallback({ browserClient, profileTab, account, primaryResult: result, config });
  }
  const accountVideos = await extractAccountVideos({ browserClient, listTab: profileTab, detailTab: undefined, account });
  if (accountVideos.status && accountVideos.status !== "ok") {
    return runProfileVideosFallback({ browserClient, profileTab, account, primaryResult: accountVideos, config });
  }
  return {
    status: "ok",
    videoLinks: (accountVideos.videos ?? []).map((video) => ({ videoUrl: video.videoUrl, views: Number(video.views ?? 0) })),
    videos: accountVideos.videos ?? []
  };
}

function normalizeProfileVideosResult(result) {
  if (Array.isArray(result)) {
    return {
      status: "ok",
      videoLinks: result,
      videos: []
    };
  }
  return result ?? { status: "missing_metrics", reason: "profile video extraction returned no data" };
}

async function extractShopProducts({ browserClient, listTab, detailTab, shop }) {
  if (browserClient.extractShopProducts.length >= 2) {
    return browserClient.extractShopProducts(listTab, shop);
  }
  return browserClient.extractShopProducts({ listTab, detailTab, shop });
}

async function extractDirectVideo({ browserClient, detailTab, video, config = {} }) {
  if (browserClient.extractDirectVideo) {
    const result = await browserClient.extractDirectVideo({ detailTab, video });
    return runDirectVideoFallback({ browserClient, detailTab, video, primaryResult: result, config });
  }
  return { status: "missing_metrics", reason: "browser client does not support direct video seeds" };
}

async function runProfileVideosFallback({ browserClient, profileTab, account, primaryResult, config = {} }) {
  if (!primaryResult?.status || primaryResult.status === "ok") return primaryResult;
  const fallback = config.extractProfileVideosFallback;
  if (typeof fallback !== "function") return primaryResult;
  try {
    const fallbackResult = await fallback({ browserClient, profileTab, account, primaryResult });
    return fallbackResult ?? primaryResult;
  } catch {
    return primaryResult;
  }
}

async function runDirectVideoFallback({ browserClient, detailTab, video, primaryResult, config = {} }) {
  if (!primaryResult?.status || primaryResult.status === "ok") return primaryResult;
  const fallback = config.extractDirectVideoFallback;
  if (typeof fallback !== "function") return primaryResult;
  try {
    const fallbackResult = await fallback({ browserClient, detailTab, video, primaryResult });
    return fallbackResult ?? primaryResult;
  } catch {
    return primaryResult;
  }
}

function normalizeVideoSnapshot({ collectedAt, account, video }) {
  return {
    collectedAt,
    source: "chrome",
    accountHandle: video.accountHandle ?? account.handle,
    videoUrl: video.videoUrl ?? video.url,
    caption: video.caption ?? "",
    postedAt: normalizeTikTokVideoPostedAt({ videoUrl: video.videoUrl ?? video.url, postedAt: video.postedAt }),
    views: Number(video.views ?? 0),
    likes: Number(video.likes ?? 0),
    comments: Number(video.comments ?? 0),
    shares: Number(video.shares ?? 0),
    productRefs: video.productRefs ?? []
  };
}

function synthesizeHomepageSnapshot({ account, profileVideo, previous }) {
  return {
    accountHandle: account.handle,
    videoUrl: profileVideo.videoUrl,
    caption: previous?.caption ?? "",
    postedAt: previous?.postedAt ?? previous?.latestPublishedAt ?? undefined,
    views: Number(profileVideo.views ?? previous?.views ?? 0),
    likes: Number(previous?.likes ?? 0),
    comments: Number(previous?.comments ?? 0),
    shares: Number(previous?.shares ?? 0),
    productRefs: Array.isArray(previous?.productRefs) ? previous.productRefs : []
  };
}

function shouldSkipDetailRefresh({ profileVideo, previous, viewDeltaThreshold = 1000 }) {
  if (!previous) return false;
  const currentViews = Number(profileVideo?.views);
  if (!Number.isFinite(currentViews) || currentViews <= 0) return false;
  const previousViews = Number(previous?.views);
  if (!Number.isFinite(previousViews) || previousViews < 0) return false;
  return Math.abs(currentViews - previousViews) < Number(viewDeltaThreshold ?? 1000);
}

function shouldRequestRecycle({
  config = {},
  consecutiveLoginRequired = 0,
  consecutiveNavigationFailures = 0,
  consecutiveShallowContent = 0,
  detailAttempts = 0,
  detailSuccesses = 0
} = {}) {
  if (consecutiveLoginRequired >= Number(config.recycleLoginRequiredThreshold ?? 5)) {
    return "login_required_threshold";
  }
  if (consecutiveNavigationFailures >= Number(config.recycleNavigationFailureThreshold ?? 3)) {
    return "navigation_failure_threshold";
  }
  if (consecutiveShallowContent >= Number(config.recycleShallowContentThreshold ?? 5)) {
    return "shallow_content_threshold";
  }
  const minAttempts = Number(config.recycleLowSuccessMinAttempts ?? 20);
  const minSuccessRate = Number(config.recycleLowSuccessRateThreshold ?? 0.1);
  if (detailAttempts >= minAttempts) {
    const successRate = detailAttempts > 0 ? detailSuccesses / detailAttempts : 0;
    if (successRate < minSuccessRate) {
      return "low_success_rate";
    }
  }
  return null;
}

function updateFailureStreaks({ response, failure, state }) {
  const next = { ...state };
  const normalizedStatus = String(response?.status ?? failure?.status ?? "").trim().toLowerCase();
  const normalizedReason = String(response?.reason ?? failure?.reason ?? "").trim().toLowerCase();
  next.consecutiveLoginRequired = normalizedStatus === "login_required" ? next.consecutiveLoginRequired + 1 : 0;
  next.consecutiveShallowContent =
    normalizedStatus === "missing_metrics" ? next.consecutiveShallowContent + 1 : 0;
  next.consecutiveNavigationFailures =
    normalizedStatus === "failed" && /timeout|navigation|net::|context|target page/i.test(normalizedReason)
      ? next.consecutiveNavigationFailures + 1
      : 0;
  return next;
}

function normalizeProductSnapshot({ collectedAt, shop, product }) {
  return {
    collectedAt,
    source: "chrome",
    shopName: product.shopName ?? shop.name,
    productUrl: product.productUrl ?? product.url,
    title: product.title ?? "",
    price: Number(product.price ?? 0),
    soldCount: Number(product.soldCount ?? 0),
    reviewCount: Number(product.reviewCount ?? 0),
    rating: Number(product.rating ?? 0)
  };
}

function buildFailure({ targetType, target, response }) {
  return {
    targetType,
    targetId: target.id,
    targetName: target.handle ?? target.name ?? target.accountHandle,
    targetUrl: target.profileUrl ?? target.shopUrl ?? target.videoUrl,
    status: response.status ?? "blocked",
    reason: response.reason ?? "collector could not read public page data"
  };
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/login/i.test(message)) return { status: "login_required", reason: message };
  if (/captcha|blocked|region/i.test(message)) return { status: "blocked", reason: message };
  return { status: "failed", reason: message };
}
