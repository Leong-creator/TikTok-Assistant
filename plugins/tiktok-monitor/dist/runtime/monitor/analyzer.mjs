export function selectCollectionTargets() {
  const { now = new Date(), staleAccountDays = 60, accounts = [], shops = [] } = arguments[0] ?? {};
  const current = new Date(now);
  const activeAccounts = [];
  const staleAccounts = [];

  for (const account of accounts.filter((item) => item.enabled !== false)) {
    const ageDays = account.lastKnownPostAt ? wholeDaysBetween(new Date(account.lastKnownPostAt), current) : 0;
    if (account.lastKnownPostAt && ageDays > staleAccountDays) {
      staleAccounts.push({
        ...account,
        stale: true,
        staleReason: `last post is ${ageDays} days old`
      });
      continue;
    }
    activeAccounts.push({ ...account, stale: false });
  }

  return {
    accounts: activeAccounts,
    staleAccounts,
    shops: shops.filter((item) => item.enabled !== false)
  };
}

export function analyzeVideoSnapshots(snapshots = [], options = {}) {
  const now = new Date(options.now ?? new Date());
  const min3hViews = Number(options.min3hViews ?? 3000);
  const min6hViews = Number(options.min6hViews ?? 3000);
  const min24hViews = Number(options.min24hViews ?? 10000);
  const min3hLikes = Number(options.min3hLikes ?? 3000);
  const min3hShares = Number(options.min3hShares ?? 500);
  const min3hComments = Number(options.min3hComments ?? 100);
  const signals = [];

  for (const group of groupBy(snapshots, (snapshot) => snapshot.videoUrl).values()) {
    const sorted = group
      .filter((snapshot) => snapshot.videoUrl && snapshot.collectedAt)
      .sort((left, right) => new Date(left.collectedAt) - new Date(right.collectedAt));
    if (sorted.length < 2) continue;

    const current = sorted.at(-1);
    const previous = findPreviousSnapshot(sorted, current, 24);
    if (!previous) continue;

    const windowHours = Math.max(1, Math.round(hoursBetween(new Date(previous.collectedAt), new Date(current.collectedAt))));
    const deltas = {
      views: numberDelta(previous.views, current.views),
      likes: numberDelta(previous.likes, current.likes),
      comments: numberDelta(previous.comments, current.comments),
      shares: numberDelta(previous.shares, current.shares)
    };
    const freshPost = current.postedAt ? hoursBetween(new Date(current.postedAt), now) <= 72 : true;
    const meets3h = windowHours <= 3 && deltas.views >= min3hViews;
    const meets6h = windowHours <= 6 && deltas.views >= min6hViews;
    const meets24h = windowHours <= 24 && deltas.views >= min24hViews;
    const viewsUnavailable = Number(previous.views ?? 0) === 0 && Number(current.views ?? 0) === 0;
    const interactionFallback =
      viewsUnavailable &&
      windowHours <= 3 &&
      (deltas.likes >= min3hLikes || deltas.shares >= min3hShares || deltas.comments >= min3hComments);
    if (!freshPost || (!meets3h && !meets6h && !meets24h && !interactionFallback)) continue;

    const engagementRate = safeRatio(
      Number(current.likes ?? 0) + Number(current.comments ?? 0) + Number(current.shares ?? 0),
      Number(current.views ?? 0)
    );
    const score = clampScore(
      50 +
        Math.min(25, Math.floor(deltas.views / 200)) +
        (engagementRate >= 0.01 ? 10 : 0) +
        (freshPost ? 10 : 0)
    );
    const reasons = interactionFallback
      ? [
          `${windowHours}h interaction fallback: likes +${deltas.likes}, comments +${deltas.comments}, shares +${deltas.shares}`,
          "views unavailable"
        ]
      : [
          `${windowHours}h views +${deltas.views}`,
          `engagement ${(engagementRate * 100).toFixed(1)}%`
        ];

    signals.push({
      entityType: "video",
      entityUrl: current.videoUrl,
      accountHandle: current.accountHandle,
      caption: current.caption,
      windowHours,
      previous,
      current,
      deltas,
      score,
      reasons,
      recommendedAction: "create_lead",
      detectedAt: now.toISOString()
    });
  }

  return signals.sort((left, right) => right.score - left.score);
}

export function analyzeProductSnapshots(snapshots = [], options = {}) {
  const now = new Date(options.now ?? new Date());
  const signals = [];

  for (const group of groupBy(snapshots, (snapshot) => snapshot.productUrl).values()) {
    const sorted = group
      .filter((snapshot) => snapshot.productUrl && snapshot.collectedAt)
      .sort((left, right) => new Date(left.collectedAt) - new Date(right.collectedAt));
    if (sorted.length < 2) continue;

    const current = sorted.at(-1);
    const previous = findPreviousSnapshot(sorted, current, 24);
    if (!previous) continue;

    const windowHours = Math.max(1, Math.round(hoursBetween(new Date(previous.collectedAt), new Date(current.collectedAt))));
    const deltas = {
      soldCount: numberDelta(previous.soldCount, current.soldCount),
      reviewCount: numberDelta(previous.reviewCount, current.reviewCount),
      price: roundedNumberDelta(previous.price, current.price)
    };
    if (deltas.soldCount <= 0 && deltas.reviewCount <= 0 && deltas.price === 0) continue;

    const reasons = [];
    if (deltas.soldCount > 0) reasons.push(`sold count +${deltas.soldCount}`);
    if (deltas.reviewCount > 0) reasons.push(`review count +${deltas.reviewCount}`);
    if (deltas.price !== 0) reasons.push(`price ${deltas.price > 0 ? "+" : ""}${deltas.price}`);

    signals.push({
      entityType: "product",
      entityUrl: current.productUrl,
      shopName: current.shopName,
      title: current.title,
      windowHours,
      previous,
      current,
      deltas,
      score: clampScore(55 + Math.min(30, deltas.soldCount) + Math.min(10, deltas.reviewCount)),
      reasons,
      recommendedAction: "watch_product",
      detectedAt: now.toISOString()
    });
  }

  return signals.sort((left, right) => right.score - left.score);
}

function findPreviousSnapshot(sorted, current, maxHours) {
  const currentTime = new Date(current.collectedAt);
  return [...sorted]
    .slice(0, -1)
    .reverse()
    .find((snapshot) => hoursBetween(new Date(snapshot.collectedAt), currentTime) <= maxHours);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function wholeDaysBetween(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function numberDelta(previous, current) {
  return Number(current ?? 0) - Number(previous ?? 0);
}

function roundedNumberDelta(previous, current) {
  return Number((Number(current ?? 0) - Number(previous ?? 0)).toFixed(2));
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
