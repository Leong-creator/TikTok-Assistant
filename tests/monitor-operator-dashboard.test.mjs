import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOperatorDashboardData } from "../src/monitor/operator-dashboard.mjs";

test("buildOperatorDashboardData returns operator-ready cards and account drilldown data", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-dashboard-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });

    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          sourceQueries: ["people skills"],
          enabled: true
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
        accountHandle: "book_alpha",
        signalKind: "new_breakout",
        signalLabel: "3天内新爆",
        current: {
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
          postedAt: "2026-05-20T08:00:00.000Z",
          views: 12000,
          likes: 1500,
          comments: 80,
          shares: 130
        },
        currentMetrics: { views: 12000, likes: 1500, comments: 80, shares: 130 },
        benchmark: { viewMultiple: 2.1 },
        deltas: { views: 3000, likes: 400, comments: 20, shares: 40 },
        score: 88,
        detectedAt: "2026-05-21T10:00:00.000Z"
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        JSON.stringify({
          collectedAt: "2026-05-21T11:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
          postedAt: "2026-05-20T08:00:00.000Z",
          caption: "People Skills can save your child years of mistakes",
          views: 12000,
          likes: 1500,
          comments: 80,
          shares: 130
        }),
        JSON.stringify({
          collectedAt: "2026-05-21T11:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590991",
          postedAt: "2026-05-18T08:00:00.000Z",
          caption: "Another people skills story",
          views: 5000,
          likes: 500,
          comments: 20,
          shares: 15
        })
      ].join("\n") + "\n"
    );
    await writeFile(
      path.join(dataDir, "base_dashboard_config.json"),
      JSON.stringify({ url: "https://example.com/base/tiktok" })
    );

    const result = await buildOperatorDashboardData({
      dataDir,
      now: new Date("2026-05-21T12:00:00.000Z")
    });

    assert.equal(result.stats.totalAccounts, 1);
    assert.equal(result.stats.totalVideos, 2);
    assert.equal(result.cards.length, 4);
    assert.equal(result.cards[0].label, "今日头号爆点");
    assert.match(result.cards[0].summary, /book_alpha|24h播放/u);
    assert.equal(result.mustWatch.length, 1);
    assert.equal(result.accountRank.length, 1);
    assert.ok(result.actionPlan.length >= 1);
    assert.ok(result.actionPlan.length <= 3);
    assert.ok(result.actionPlan[0].metricValue);
    assert.match(result.headline, /book_alpha/u);
    assert.equal(result.watchAccounts.length, 1);
    assert.equal(result.signalBreakdown.newBreakout, 1);
    assert.equal(result.baseUrl, "https://example.com/base/tiktok");
    assert.equal(result.accountRank[0].handle, "book_alpha");
    assert.equal(result.accountRank[0].theme, "people skills");
    assert.equal(result.videos.filter((item) => item.accountHandle === "book_alpha").length, 2);
    assert.ok(Array.isArray(result.themeRank));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
