import { resolveTikTokVideoPostedAt } from "./video-time.mjs";

const DEFAULT_STRONG_VIDEO_THRESHOLDS = {
  days: 7,
  likes: 1000,
  shares: 100,
  comments: 50,
  views: 10000
};

export function rankRecentStrongVideos({ videoSnapshots = [], now = new Date(), maxVideos = 5, thresholds = {} } = {}) {
  const resolvedThresholds = { ...DEFAULT_STRONG_VIDEO_THRESHOLDS, ...thresholds };
  return [...buildRecentStrongVideoMap({ videoSnapshots, now, thresholds: resolvedThresholds }).values()]
    .sort((left, right) => {
      if (right.shares !== left.shares) return right.shares - left.shares;
      if (right.likes !== left.likes) return right.likes - left.likes;
      if (right.views !== left.views) return right.views - left.views;
      return new Date(right.publishedAt) - new Date(left.publishedAt);
    })
    .slice(0, maxVideos);
}

export function buildRecentStrongVideoMap({ videoSnapshots = [], now = new Date(), thresholds = {} } = {}) {
  const resolvedThresholds = { ...DEFAULT_STRONG_VIDEO_THRESHOLDS, ...thresholds };
  const latestByUrl = dedupeLatestSnapshots(videoSnapshots);
  const strongVideos = new Map();

  for (const snapshot of latestByUrl.values()) {
    const publishedAt = resolvePublishedAt(snapshot);
    if (!publishedAt) continue;
    if (hoursBetween(new Date(publishedAt), now) > 24 * resolvedThresholds.days) continue;

    const views = Number(snapshot.views ?? 0);
    const likes = Number(snapshot.likes ?? 0);
    const comments = Number(snapshot.comments ?? 0);
    const shares = Number(snapshot.shares ?? 0);
    const qualifies =
      likes >= resolvedThresholds.likes ||
      shares >= resolvedThresholds.shares ||
      comments >= resolvedThresholds.comments ||
      views >= resolvedThresholds.views;
    if (!qualifies) continue;

    const reasons = [];
    if (likes >= resolvedThresholds.likes) reasons.push("点赞过千");
    if (shares >= resolvedThresholds.shares) reasons.push("转发过百");
    if (comments >= resolvedThresholds.comments) reasons.push("评论过线");
    if (views >= resolvedThresholds.views) reasons.push("播放过万");

    strongVideos.set(snapshot.videoUrl, {
      accountHandle: snapshot.accountHandle ?? "",
      videoUrl: snapshot.videoUrl,
      publishedAt,
      views,
      likes,
      comments,
      shares,
      engagementRate: safeRatio(likes + comments + shares, views),
      shareRate: safeRatio(shares, views),
      commentRate: safeRatio(comments, views),
      label: "近7天好素材",
      priority: 3,
      reasons,
      operatorAction:
        shares >= resolvedThresholds.shares
          ? "优先拆解传播点、标题和转发触发机制。"
          : "优先拆解开头钩子、选题切口和封面表达。"
    });
  }

  return strongVideos;
}

export function countRecentStrongVideosByAccount({ videoSnapshots = [], now = new Date(), thresholds = {} } = {}) {
  const map = new Map();
  for (const video of buildRecentStrongVideoMap({ videoSnapshots, now, thresholds }).values()) {
    map.set(video.accountHandle, Number(map.get(video.accountHandle) ?? 0) + 1);
  }
  return map;
}

export function dedupeLatestSnapshots(videoSnapshots = []) {
  const latestByUrl = new Map();
  for (const snapshot of videoSnapshots) {
    if (!snapshot?.videoUrl) continue;
    const current = latestByUrl.get(snapshot.videoUrl);
    if (!current || String(snapshot.collectedAt ?? "") >= String(current.collectedAt ?? "")) {
      latestByUrl.set(snapshot.videoUrl, snapshot);
    }
  }
  return latestByUrl;
}

export function resolvePublishedAt(snapshot) {
  return resolveTikTokVideoPostedAt(snapshot) || "";
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / 3_600_000;
}
