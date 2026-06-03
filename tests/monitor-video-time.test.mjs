import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTikTokVideoPostedAt, resolveTikTokVideoPostedAt } from "../src/monitor/video-time.mjs";

test("resolveTikTokVideoPostedAt prefers explicit postedAt when present", () => {
  const resolved = resolveTikTokVideoPostedAt({
    videoUrl: "https://www.tiktok.com/@sample/video/7615117401406491926",
    postedAt: "2026-05-19T08:00:00+08:00"
  });

  assert.equal(resolved, "2026-05-19T00:00:00.000Z");
});

test("resolveTikTokVideoPostedAt derives timestamp from TikTok video id", () => {
  const unixSeconds = 1737117744n;
  const syntheticVideoId = (unixSeconds << 32n).toString();
  const resolved = resolveTikTokVideoPostedAt(`https://www.tiktok.com/@guidance811/video/${syntheticVideoId}`);

  assert.equal(resolved, "2025-01-17T12:42:24.000Z");
});

test("normalizeTikTokVideoPostedAt returns undefined for invalid video ids", () => {
  const normalized = normalizeTikTokVideoPostedAt({
    videoUrl: "https://www.tiktok.com/@sample/video/1"
  });

  assert.equal(normalized, undefined);
});
