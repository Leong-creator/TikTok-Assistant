export function isLikelyTikTokVideoId(value) {
  const text = String(value ?? "").trim();
  return /^\d{19}$/u.test(text) || /^mock-[a-z0-9-]+$/iu.test(text);
}

export function isCanonicalTikTokVideoUrl(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/tiktok\.com\/@[^/]+\/video\/([^/?#]+)/iu);
  return Boolean(match?.[1] && isLikelyTikTokVideoId(match[1]));
}

export function resolveTikTokVideoPostedAt(snapshotOrUrl) {
  const postedAt = normalizePostedAt(snapshotOrUrl?.postedAt);
  if (postedAt) return postedAt;

  const videoUrl = typeof snapshotOrUrl === "string"
    ? snapshotOrUrl
    : snapshotOrUrl?.videoUrl ?? snapshotOrUrl?.url ?? "";
  const match = String(videoUrl).match(/\/video\/([^/?#]+)/iu);
  if (!match || !isLikelyTikTokVideoId(match[1])) return "";
  try {
    const unixSeconds = Number(BigInt(match[1]) >> 32n);
    const derived = new Date(unixSeconds * 1000);
    if (Number.isNaN(derived.getTime())) return "";
    if (derived.getUTCFullYear() < 2018 || derived.getUTCFullYear() > 2100) return "";
    return derived.toISOString();
  } catch {
    return "";
  }
}

export function normalizeTikTokVideoPostedAt({ videoUrl, postedAt } = {}) {
  return resolveTikTokVideoPostedAt({ videoUrl, postedAt }) || undefined;
}

function normalizePostedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
