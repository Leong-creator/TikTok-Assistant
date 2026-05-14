export async function collectMockSnapshots({ now = new Date(), accounts = [], shops = [], videos = [] } = {}) {
  const current = new Date(now);
  const previous = new Date(current.getTime() - 6 * 3_600_000);
  const videoSnapshots = [];
  const productSnapshots = [];

  for (const account of accounts.filter((item) => item.enabled !== false)) {
    const videoUrl = `${account.profileUrl.replace(/\/$/u, "")}/video/mock-fast-growth`;
    videoSnapshots.push({
      collectedAt: previous.toISOString(),
      source: "mock",
      accountHandle: account.handle,
      videoUrl,
      caption: "A fast-growing book lesson video",
      postedAt: new Date(current.getTime() - 8 * 3_600_000).toISOString(),
      views: 1000,
      likes: 20,
      comments: 1,
      shares: 1,
      productRefs: []
    });
    videoSnapshots.push({
      collectedAt: current.toISOString(),
      source: "mock",
      accountHandle: account.handle,
      videoUrl,
      caption: "A fast-growing book lesson video",
      postedAt: new Date(current.getTime() - 8 * 3_600_000).toISOString(),
      views: 5200,
      likes: 130,
      comments: 12,
      shares: 7,
      productRefs: []
    });
  }

  for (const video of videos.filter((item) => item.enabled !== false)) {
    videoSnapshots.push({
      collectedAt: previous.toISOString(),
      source: "mock",
      accountHandle: video.accountHandle ?? "direct_video",
      videoUrl: video.videoUrl,
      caption: "A direct seeded book lesson video",
      postedAt: new Date(current.getTime() - 8 * 3_600_000).toISOString(),
      views: 1000,
      likes: 20,
      comments: 1,
      shares: 1,
      productRefs: []
    });
    videoSnapshots.push({
      collectedAt: current.toISOString(),
      source: "mock",
      accountHandle: video.accountHandle ?? "direct_video",
      videoUrl: video.videoUrl,
      caption: "A direct seeded book lesson video",
      postedAt: new Date(current.getTime() - 8 * 3_600_000).toISOString(),
      views: 5200,
      likes: 130,
      comments: 12,
      shares: 7,
      productRefs: []
    });
  }

  for (const shop of shops.filter((item) => item.enabled !== false)) {
    const productUrl = `${shop.shopUrl.replace(/\/$/u, "")}/product/mock-fast-growth`;
    productSnapshots.push({
      collectedAt: previous.toISOString(),
      source: "mock",
      shopName: shop.name,
      productUrl,
      title: `${shop.name} hero book`,
      price: 19.99,
      soldCount: 10,
      reviewCount: 2,
      rating: 4.6
    });
    productSnapshots.push({
      collectedAt: current.toISOString(),
      source: "mock",
      shopName: shop.name,
      productUrl,
      title: `${shop.name} hero book`,
      price: 18.99,
      soldCount: 36,
      reviewCount: 8,
      rating: 4.7
    });
  }

  return {
    source: "mock",
    collectedAt: current.toISOString(),
    videoSnapshots,
    productSnapshots,
    failures: []
  };
}
