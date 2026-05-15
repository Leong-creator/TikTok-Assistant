import { ChromeTabLedger } from "./tab-ledger.mjs";

export async function collectChromeSnapshots({
  now = new Date(),
  maxTabs = 2,
  browserClient,
  accounts = [],
  shops = [],
  videos = []
} = {}) {
  if (!browserClient) {
    throw new Error("chrome_unavailable: browserClient is required for chrome collection");
  }

  const ledger = new ChromeTabLedger({ browser: browserClient, maxTabs });
  const collectedAt = new Date(now).toISOString();
  const videoSnapshots = [];
  const productSnapshots = [];
  const failures = [];

  try {
    for (const video of videos.filter((item) => item.enabled !== false)) {
      let detailTab;
      try {
        detailTab = await ledger.acquire("video-detail");
        await browserClient.navigate(detailTab, video.videoUrl);
        const response = await extractDirectVideo({ browserClient, detailTab, video });
        if (response.status && response.status !== "ok") {
          failures.push(buildFailure({ targetType: "video", target: video, response }));
          continue;
        }
        videoSnapshots.push(normalizeVideoSnapshot({
          collectedAt,
          account: { handle: video.accountHandle },
          video: response.video
        }));
      } catch (error) {
        failures.push(buildFailure({ targetType: "video", target: video, response: classifyError(error) }));
      } finally {
        if (detailTab) await ledger.release(detailTab.id);
      }
    }

    for (const account of accounts.filter((item) => item.enabled !== false)) {
      let listTab;
      let detailTab;
      try {
        listTab = await ledger.acquire("account-list");
        detailTab = browserClient.usesDetailTab ? await ledger.acquire("video-detail") : undefined;
        await browserClient.navigate(listTab, account.profileUrl);
        const response = await extractAccountVideos({ browserClient, listTab, detailTab, account });
        if (response.status && response.status !== "ok") {
          failures.push(buildFailure({ targetType: "account", target: account, response }));
          continue;
        }
        failures.push(...(response.failures ?? []));
        for (const video of response.videos ?? []) {
          videoSnapshots.push(normalizeVideoSnapshot({ collectedAt, account, video }));
        }
      } catch (error) {
        failures.push(buildFailure({ targetType: "account", target: account, response: classifyError(error) }));
      } finally {
        if (detailTab) await ledger.release(detailTab.id);
        if (listTab) await ledger.release(listTab.id);
      }
    }

    for (const shop of shops.filter((item) => item.enabled !== false)) {
      let listTab;
      let detailTab;
      try {
        listTab = await ledger.acquire("shop-detail");
        detailTab = browserClient.usesDetailTab ? await ledger.acquire("product-detail") : undefined;
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
        if (detailTab) await ledger.release(detailTab.id);
        if (listTab) await ledger.release(listTab.id);
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
    failures
  };
}

async function extractAccountVideos({ browserClient, listTab, detailTab, account }) {
  if (browserClient.extractAccountVideos.length >= 2) {
    return browserClient.extractAccountVideos(listTab, account);
  }
  return browserClient.extractAccountVideos({ listTab, detailTab, account });
}

async function extractShopProducts({ browserClient, listTab, detailTab, shop }) {
  if (browserClient.extractShopProducts.length >= 2) {
    return browserClient.extractShopProducts(listTab, shop);
  }
  return browserClient.extractShopProducts({ listTab, detailTab, shop });
}

async function extractDirectVideo({ browserClient, detailTab, video }) {
  if (browserClient.extractDirectVideo) {
    return browserClient.extractDirectVideo({ detailTab, video });
  }
  return { status: "missing_metrics", reason: "browser client does not support direct video seeds" };
}

function normalizeVideoSnapshot({ collectedAt, account, video }) {
  return {
    collectedAt,
    source: "chrome",
    accountHandle: video.accountHandle ?? account.handle,
    videoUrl: video.videoUrl ?? video.url,
    caption: video.caption ?? "",
    postedAt: video.postedAt,
    views: Number(video.views ?? 0),
    likes: Number(video.likes ?? 0),
    comments: Number(video.comments ?? 0),
    shares: Number(video.shares ?? 0),
    productRefs: video.productRefs ?? []
  };
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
