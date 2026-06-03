import { resolveTikTokVideoPostedAt } from "./video-time.mjs";

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
  const latestSnapshots = latestSnapshotsByVideoUrl(snapshots);
  const accountBenchmarks = buildAccountBenchmarks({ snapshots: latestSnapshots, now });

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
    const ageHours = resolveAgeHours(current, now);
    const ageBucket = resolveAgeBucket(ageHours);
    if (!ageBucket) continue;

    const meets3h = windowHours <= 3 && deltas.views >= min3hViews;
    const meets6h = windowHours <= 6 && deltas.views >= min6hViews;
    const meets24h = windowHours <= 24 && deltas.views >= min24hViews;
    const viewsUnavailable = Number(previous.views ?? 0) === 0 && Number(current.views ?? 0) === 0;
    const interactionFallback =
      viewsUnavailable &&
      windowHours <= 3 &&
      (deltas.likes >= min3hLikes || deltas.shares >= min3hShares || deltas.comments >= min3hComments);

    const benchmark = accountBenchmarks.get(current.accountHandle ?? "") ?? defaultBenchmark();
    const engagementRate = safeRatio(
      Number(current.likes ?? 0) + Number(current.comments ?? 0) + Number(current.shares ?? 0),
      Number(current.views ?? 0)
    );
    const shareRate = safeRatio(Number(current.shares ?? 0), Number(current.views ?? 0));
    const commentRate = safeRatio(Number(current.comments ?? 0), Number(current.views ?? 0));
    const baselineViewMultiple = safeMultiple(Number(current.views ?? 0), benchmark.medianViews);
    const baselineShareMultiple = safeMultiple(Number(current.shares ?? 0), benchmark.medianShares);
    const baselineEngagementMultiple = safeMultiple(engagementRate, benchmark.medianEngagementRate);

    const signalKind = classifyVideoSignal({
      ageBucket,
      windowHours,
      deltas,
      meets3h,
      meets6h,
      meets24h,
      interactionFallback,
      baselineViewMultiple,
      baselineShareMultiple,
      baselineEngagementMultiple,
      benchmarkSampleSize: benchmark.sampleSize,
      shareRate,
      commentRate
    });
    if (!signalKind) continue;

    const score = scoreVideoSignal({
      signalKind,
      deltas,
      baselineViewMultiple,
      baselineShareMultiple,
      baselineEngagementMultiple,
      shareRate,
      commentRate
    });
    const reasons = interactionFallback
      ? [
          `${windowHours}h interaction fallback: likes +${deltas.likes}, comments +${deltas.comments}, shares +${deltas.shares}`,
          "views unavailable"
        ]
      : [
          `${windowHours}h views +${deltas.views}`,
          `engagement ${(engagementRate * 100).toFixed(1)}%`,
          `vs account median x${baselineViewMultiple.toFixed(2)}`
        ];

    signals.push({
      entityType: "video",
      entityUrl: current.videoUrl,
      accountHandle: current.accountHandle,
      caption: current.caption,
      windowHours,
      ageHours,
      ageBucket: ageBucket.label,
      signalKind: signalKind.key,
      signalLabel: signalKind.label,
      signalPriority: signalKind.priority,
      anomalyLevel: signalKind.label,
      previous,
      current,
      deltas,
      score,
      currentMetrics: {
        views: Number(current.views ?? 0),
        likes: Number(current.likes ?? 0),
        comments: Number(current.comments ?? 0),
        shares: Number(current.shares ?? 0),
        engagementRate,
        shareRate,
        commentRate
      },
      benchmark: {
        sampleSize: benchmark.sampleSize,
        medianViews: benchmark.medianViews,
        medianShares: benchmark.medianShares,
        medianEngagementRate: benchmark.medianEngagementRate,
        viewMultiple: baselineViewMultiple,
        shareMultiple: baselineShareMultiple,
        engagementMultiple: baselineEngagementMultiple
      },
      reasons,
      recommendedAction: signalKind.recommendedAction,
      operatorAction: signalKind.operatorAction,
      leadEligible: true,
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

function safeMultiple(value, baseline) {
  const current = Number(value ?? 0);
  const reference = Number(baseline ?? 0);
  if (reference > 0) return current / reference;
  return current > 0 ? 1 : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function latestSnapshotsByVideoUrl(snapshots) {
  const latest = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.videoUrl) continue;
    const current = latest.get(snapshot.videoUrl);
    if (!current || String(snapshot.collectedAt ?? "") >= String(current.collectedAt ?? "")) {
      latest.set(snapshot.videoUrl, snapshot);
    }
  }
  return [...latest.values()];
}

function buildAccountBenchmarks({ snapshots, now }) {
  const byAccount = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.accountHandle) continue;
    const ageHours = resolveAgeHours(snapshot, now);
    if (!Number.isFinite(ageHours) || ageHours > 24 * 15) continue;
    if (!byAccount.has(snapshot.accountHandle)) byAccount.set(snapshot.accountHandle, []);
    byAccount.get(snapshot.accountHandle).push(snapshot);
  }

  const benchmarks = new Map();
  for (const [handle, items] of byAccount.entries()) {
    const views = items.map((item) => Number(item.views ?? 0)).filter((value) => value > 0);
    const shares = items.map((item) => Number(item.shares ?? 0)).filter((value) => value >= 0);
    const engagementRates = items
      .map((item) =>
        safeRatio(
          Number(item.likes ?? 0) + Number(item.comments ?? 0) + Number(item.shares ?? 0),
          Number(item.views ?? 0)
        )
      )
      .filter((value) => value >= 0);
    benchmarks.set(handle, {
      sampleSize: items.length,
      medianViews: median(views),
      medianShares: median(shares),
      medianEngagementRate: median(engagementRates)
    });
  }
  return benchmarks;
}

function defaultBenchmark() {
  return {
    sampleSize: 0,
    medianViews: 0,
    medianShares: 0,
    medianEngagementRate: 0
  };
}

function resolveAgeHours(snapshot, now) {
  const postedAtValue = resolveTikTokVideoPostedAt(snapshot);
  if (!postedAtValue) return 0;
  const postedAt = new Date(postedAtValue);
  if (Number.isNaN(postedAt.getTime())) return 0;
  return hoursBetween(postedAt, now);
}

function resolveAgeBucket(ageHours) {
  if (ageHours <= 24 * 3) return { key: "recent_3d", label: "3天内新爆", priority: 1 };
  if (ageHours <= 24 * 7) return { key: "recent_7d", label: "4-7天持续涨", priority: 2 };
  if (ageHours <= 24 * 15) return { key: "recent_15d", label: "8-15天长尾爆", priority: 3 };
  return undefined;
}

function classifyVideoSignal({
  ageBucket,
  windowHours,
  deltas,
  meets3h,
  meets6h,
  meets24h,
  interactionFallback,
  baselineViewMultiple,
  baselineShareMultiple,
  baselineEngagementMultiple,
  benchmarkSampleSize,
  shareRate,
  commentRate
}) {
  if (ageBucket.key === "recent_3d") {
    if (
      interactionFallback ||
      (benchmarkSampleSize < 3 && (meets3h || meets6h)) ||
      ((meets3h || meets6h) && baselineViewMultiple >= 1.5) ||
      (deltas.views >= 5000 && (shareRate >= 0.004 || commentRate >= 0.001))
    ) {
      return {
        key: "new_breakout",
        label: "3天内新爆",
        priority: 1,
        recommendedAction: "create_lead",
        operatorAction: "优先拆解开头钩子、题材切口和评论区反馈。"
      };
    }
    return undefined;
  }

  if (ageBucket.key === "recent_7d") {
    if (
      (windowHours <= 24 && (deltas.views >= Math.max(1800, Math.floor((baselineViewMultiple > 1 ? 1200 : 2000))) || deltas.shares >= 80 || deltas.comments >= 20)) &&
      (
        benchmarkSampleSize < 3 ||
        baselineViewMultiple >= 1.25 ||
        baselineShareMultiple >= 1.4 ||
        baselineEngagementMultiple >= 1.3 ||
        meets24h
      )
    ) {
      return {
        key: "sustained_growth",
        label: "4-7天持续涨",
        priority: 2,
        recommendedAction: "watch_competitor",
        operatorAction: "继续跟踪下一轮增量，确认是否值得模仿结构或节奏。"
      };
    }
    return undefined;
  }

  if (
    (baselineViewMultiple >= 1.8 || baselineShareMultiple >= 1.8 || baselineEngagementMultiple >= 1.5) &&
    (deltas.views > 0 || deltas.shares > 0 || deltas.comments > 0)
  ) {
    return {
      key: "long_tail_winner",
      label: "8-15天长尾爆",
      priority: 3,
      recommendedAction: "archive_pattern",
      operatorAction: "进入复盘库，重点总结题材、节奏和转发驱动。"
    };
  }

  return undefined;
}

function scoreVideoSignal({
  signalKind,
  deltas,
  baselineViewMultiple,
  baselineShareMultiple,
  baselineEngagementMultiple,
  shareRate,
  commentRate
}) {
  const base = signalKind.key === "new_breakout"
    ? 70
    : signalKind.key === "sustained_growth"
      ? 63
      : 58;
  return clampScore(
    base +
      Math.min(12, Math.floor(Number(deltas.views ?? 0) / 1200)) +
      Math.min(8, Math.floor(Number(deltas.shares ?? 0) / 80)) +
      Math.min(6, Math.floor(Number(deltas.comments ?? 0) / 20)) +
      Math.min(8, Math.round(Math.max(0, baselineViewMultiple - 1) * 5)) +
      Math.min(6, Math.round(Math.max(0, baselineShareMultiple - 1) * 4)) +
      Math.min(5, Math.round(Math.max(0, baselineEngagementMultiple - 1) * 4)) +
      (shareRate >= 0.005 ? 4 : 0) +
      (commentRate >= 0.001 ? 3 : 0)
  );
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}
