import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildMonitorReport, sendMonitorReport } from "../src/monitor/reporting.mjs";

test("buildMonitorReport summarizes tracked accounts, shops, and recent signals", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        { handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true },
        { handle: "book_beta", profileUrl: "https://www.tiktok.com/@book_beta", enabled: true }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify([
        { handle: "candidate_alpha", profileUrl: "https://www.tiktok.com/@candidate_alpha", status: "candidate" }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "shops.json"),
      JSON.stringify([
        { shopUrl: "https://www.tiktok.com/shop/alpha", enabled: true }
      ])
    );
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      [
        JSON.stringify({
          entityType: "video",
          entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
          accountHandle: "book_alpha",
          signalKind: "new_breakout",
          signalLabel: "3天内新爆",
          windowHours: 3,
          current: {
            videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
            postedAt: "2026-05-10T07:00:00.000Z",
            views: 15600,
            likes: 1100,
            comments: 96,
            shares: 72
          },
          currentMetrics: {
            views: 15600,
            likes: 1100,
            comments: 96,
            shares: 72
          },
          benchmark: {
            viewMultiple: 2.4
          },
          deltas: { views: 3600, likes: 200, comments: 20, shares: 10 },
          score: 88,
          detectedAt: "2026-05-10T09:00:00.000Z"
        }),
        JSON.stringify({
          entityType: "product",
          entityUrl: "https://www.tiktok.com/shop/p/alpha",
          shopName: "Alpha Shop",
          windowHours: 6,
          deltas: { soldCount: 12, reviewCount: 2, price: 0 },
          score: 72,
          detectedAt: "2026-05-08T09:00:00.000Z"
        })
      ].join("\n") + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-10T10:00:00.000Z",
        accountHandle: "book_alpha",
        videoUrl: "https://www.tiktok.com/@book_alpha/video/1"
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "base_dashboard_config.json"),
      JSON.stringify({ url: "https://example.com/base/monitor" })
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.trackedAccounts, 3);
    assert.equal(result.summary.recentSignals, 1);
    assert.equal(result.summary.signalBuckets.recent3d, 1);
    assert.equal(result.summary.topSignals.length, 1);
    assert.equal(result.summary.topMustWatchVideos.length, 1);
    assert.match(result.text, /TikTok同行晨会简报/u);
    assert.match(result.text, /头号爆点主战区 TOP3：/u);
    assert.match(result.text, /book_alpha/u);
    assert.match(result.text, /24h播放 \+3,600/u);
    assert.match(result.text, /高于常规 2.40x/u);
    assert.match(result.text, /近7天可直接抄 TOP3：/u);
    assert.match(result.text, /主题先翻 TOP3：/u);
    assert.match(result.text, /今天先盯账号 TOP3：/u);
    assert.match(result.text, /先做：/u);
    assert.match(result.text, /今天顺序：先看新爆｜再翻主题｜再抄近期｜最后盯账号/u);
    assert.match(result.text, /https:\/\/example.com\/base\/monitor/u);
    assert.doesNotMatch(result.text, /候选账号/u);
    assert.doesNotMatch(result.text, /商品入口/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport falls back to the latest historical surge when no recent signals exist", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-history-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
        JSON.stringify({
          entityType: "video",
          entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
          accountHandle: "book_alpha",
          signalKind: "sustained_growth",
          signalLabel: "4-7天持续涨",
          windowHours: 6,
          current: {
            videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
            postedAt: "2026-05-07T09:00:00.000Z",
            views: 25200,
            likes: 1800,
            comments: 210,
            shares: 190
          },
          deltas: { views: 5200, likes: 380, comments: 41, shares: 26 },
          score: 91,
          detectedAt: "2026-05-08T09:00:00.000Z"
      }) + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.recentSignals, 0);
    assert.equal(result.summary.topSignals.length, 1);
    assert.equal(result.summary.topMustWatchVideos.length, 1);
    assert.match(result.text, /头号爆点主战区 TOP3：/u);
    assert.match(result.text, /24h播放 \+5,200/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport falls back to historical run snapshots when the root snapshot folder is empty", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-run-fallback-"));
  try {
    const validVideoUrl = "https://www.tiktok.com/@book_alpha/video/7623225588626590990";
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "chrome_run_a", "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "chrome_run_a", "snapshots", "video_snapshots.jsonl"),
      [
        JSON.stringify({
          collectedAt: "2026-05-10T09:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: validVideoUrl,
          postedAt: "2026-05-10T07:00:00.000Z",
          views: 1000,
          likes: 50,
          comments: 5,
          shares: 3
        }),
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: validVideoUrl,
          postedAt: "2026-05-10T07:00:00.000Z",
          views: 4500,
          likes: 260,
          comments: 19,
          shares: 11
        })
      ].join("\n") + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.trackedVideos, 1);
    assert.equal(result.summary.topSignals.length, 1);
    assert.match(result.text, /监控池：账号池 1 \| 近90天视频 1/u);
    assert.match(result.text, /24h播放 \+3,500/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport includes top recent seven-day strong videos even when no surge exists", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-recent-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        { handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true },
        { handle: "book_beta", profileUrl: "https://www.tiktok.com/@book_beta", enabled: true }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");

    const recentSeconds = Math.floor(new Date("2026-05-09T12:00:00.000Z").getTime() / 1000);
    const recentLowSeconds = Math.floor(new Date("2026-05-10T08:00:00.000Z").getTime() / 1000);
    const olderSeconds = Math.floor(new Date("2026-04-20T12:00:00.000Z").getTime() / 1000);
    const recentVideoId = String((BigInt(recentSeconds) << 32n) + 1n);
    const recentLowVideoId = String((BigInt(recentLowSeconds) << 32n) + 1n);
    const olderVideoId = String((BigInt(olderSeconds) << 32n) + 1n);

    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: `https://www.tiktok.com/@book_alpha/video/${recentVideoId}`,
          views: 12000,
          likes: 1200,
          comments: 80,
          shares: 340
        }),
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_gamma",
          videoUrl: `https://www.tiktok.com/@book_gamma/video/${recentLowVideoId}`,
          likes: 5,
          comments: 1,
          shares: 2
        }),
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_beta",
          videoUrl: `https://www.tiktok.com/@book_beta/video/${olderVideoId}`,
          likes: 9000,
          comments: 500,
          shares: 2200
        })
      ].join("\n") + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.topSignals.length, 0);
    assert.equal(result.summary.topRecentStrongVideos.length, 1);
    assert.equal(result.summary.topMustWatchVideos.length, 1);
    assert.equal(result.summary.topRecentStrongVideos[0].accountHandle, "book_alpha");
    assert.match(result.text, /近7天可直接抄 TOP3：/u);
    assert.match(result.text, /book_alpha/u);
    assert.doesNotMatch(result.text, /book_gamma/u);
    assert.match(result.text, /点赞 1,200/u);
    assert.match(result.text, /今天先盯账号 TOP3：/u);
    assert.match(result.text, /现在盯：/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport renders theme references as operator roles instead of raw aggregates", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-theme-role-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
          postedAt: "2026-05-09T08:00:00.000Z",
          views: 56000,
          likes: 6200,
          comments: 340,
          shares: 520,
          productRefs: [{ title: "people skills" }]
        }),
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/7623225588626590991",
          postedAt: "2026-05-06T08:00:00.000Z",
          views: 18000,
          likes: 1500,
          comments: 88,
          shares: 120,
          productRefs: [{ title: "people skills" }]
        })
      ].join("\n") + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.match(result.text, /主题先翻：people skills｜爆点开场/u);
    assert.match(result.text, /主题先翻 TOP3：/u);
    assert.match(result.text, /1\. people skills｜爆点开场｜高表现 2｜近7天上新 2/u);
    assert.match(result.text, /代表 book_alpha｜发布/u);
    assert.match(result.text, /先做：先拆代表视频的开场钩子和转发点/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport limits operator sections to top three items", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-top3-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        { handle: "alpha", profileUrl: "https://www.tiktok.com/@alpha", enabled: true },
        { handle: "beta", profileUrl: "https://www.tiktok.com/@beta", enabled: true },
        { handle: "gamma", profileUrl: "https://www.tiktok.com/@gamma", enabled: true },
        { handle: "delta", profileUrl: "https://www.tiktok.com/@delta", enabled: true }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      [
        {
          accountHandle: "alpha",
          entityUrl: "https://www.tiktok.com/@alpha/video/1",
          score: 95,
          views: 30000
        },
        {
          accountHandle: "beta",
          entityUrl: "https://www.tiktok.com/@beta/video/2",
          score: 90,
          views: 25000
        },
        {
          accountHandle: "gamma",
          entityUrl: "https://www.tiktok.com/@gamma/video/3",
          score: 85,
          views: 22000
        },
        {
          accountHandle: "delta",
          entityUrl: "https://www.tiktok.com/@delta/video/4",
          score: 80,
          views: 18000
        }
      ]
        .map((item, index) =>
          JSON.stringify({
            entityType: "video",
            accountHandle: item.accountHandle,
            entityUrl: item.entityUrl,
            signalKind: index === 0 ? "new_breakout" : "sustained_growth",
            signalLabel: index === 0 ? "3天内新爆" : "4-7天持续涨",
            windowHours: 6,
            current: {
              videoUrl: item.entityUrl,
              postedAt: `2026-05-0${index + 6}T07:00:00.000Z`,
              views: item.views,
              likes: 1000 - index * 50,
              comments: 80 - index * 5,
              shares: 60 - index * 5
            },
            currentMetrics: {
              views: item.views,
              likes: 1000 - index * 50,
              comments: 80 - index * 5,
              shares: 60 - index * 5
            },
            benchmark: {
              viewMultiple: 2 - index * 0.1
            },
            deltas: { views: 1000 - index * 100, likes: 100 - index * 10, comments: 10 - index, shares: 8 - index },
            score: item.score,
            detectedAt: `2026-05-10T0${index}:00:00.000Z`
          })
        )
        .join("\n") + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.topMustWatchVideos.length, 3);
    assert.equal(result.summary.topSignals.length, 3);
    assert.equal(result.summary.recentStrongCount, 0);
    assert.match(result.text, /1\. alpha/u);
    assert.match(result.text, /2\. beta/u);
    assert.match(result.text, /3\. gamma/u);
    assert.doesNotMatch(result.text, /4\. delta/u);
    assert.match(result.text, /近7天好素材 0 条/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport dedupes repeated signal rows for the same video and preserves publish time in must-watch text", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-dedupe-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "alpha", profileUrl: "https://www.tiktok.com/@alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      [
        {
          detectedAt: "2026-05-10T09:00:00.000Z",
          score: 88,
          views: 15600
        },
        {
          detectedAt: "2026-05-10T10:00:00.000Z",
          score: 89,
          views: 16600
        }
      ]
        .map((item) =>
          JSON.stringify({
            entityType: "video",
            entityUrl: "https://www.tiktok.com/@alpha/video/7638481786569379086",
            accountHandle: "alpha",
            signalKind: "sustained_growth",
            signalLabel: "4-7天持续涨",
            windowHours: 6,
            current: {
              videoUrl: "https://www.tiktok.com/@alpha/video/7638481786569379086",
              postedAt: "2026-05-11T04:11:02.000Z",
              views: item.views,
              likes: 1100,
              comments: 96,
              shares: 72
            },
            currentMetrics: {
              views: item.views,
              likes: 1100,
              comments: 96,
              shares: 72
            },
            benchmark: {
              viewMultiple: 2.4
            },
            deltas: { views: 3600, likes: 200, comments: 20, shares: 10 },
            score: item.score,
            detectedAt: item.detectedAt
          })
        )
        .join("\n") + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z")
    });

    assert.equal(result.summary.recentSignals, 1);
    assert.equal(result.summary.signalBuckets.recent7d, 1);
    assert.equal(result.summary.topSignals.length, 1);
    assert.equal(result.summary.topMustWatchVideos.length, 1);
    assert.match(result.text, /发布 2026-05-11 12:11:02/u);
    assert.match(result.text, /近7天好素材 0 条/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport uses whitelist accounts as the tracked pool when provided", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-whitelist-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        { handle: "legacy_alpha", profileUrl: "https://www.tiktok.com/@legacy_alpha", enabled: true },
        { handle: "legacy_beta", profileUrl: "https://www.tiktok.com/@legacy_beta", enabled: true }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: "https://www.tiktok.com/@white_alpha/video/7623225588626590990",
        accountHandle: "white_alpha",
        signalKind: "new_breakout",
        signalLabel: "3天内新爆",
        current: { videoUrl: "https://www.tiktok.com/@white_alpha/video/7623225588626590990", postedAt: "2026-05-10T07:00:00.000Z", views: 10000, likes: 1000, comments: 10, shares: 20 },
        currentMetrics: { views: 10000, likes: 1000, comments: 10, shares: 20 },
        deltas: { views: 3000, likes: 100, comments: 2, shares: 5 },
        detectedAt: "2026-05-10T09:00:00.000Z",
        score: 80
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-10T10:00:00.000Z",
        accountHandle: "white_alpha",
        videoUrl: "https://www.tiktok.com/@white_alpha/video/7623225588626590990",
        postedAt: "2026-05-10T07:00:00.000Z",
        views: 10000,
        likes: 1000,
        comments: 10,
        shares: 20
      }) + "\n"
    );

    const result = await buildMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z"),
      whitelistAccounts: [
        {
          handle: "white_alpha",
          accountName: "white_alpha",
          profileUrl: "https://www.tiktok.com/@white_alpha",
          sourceTables: ["People Skills"],
          materialTypes: ["AI动画"],
          skipTracking: false
        },
        {
          handle: "skip_me",
          accountName: "skip_me",
          profileUrl: "https://www.tiktok.com/@skip_me",
          sourceTables: ["Raise Children"],
          materialTypes: ["AI动画"],
          remark: "橱窗已掉",
          skipTracking: true
        }
      ]
    });

    assert.equal(result.summary.trackedAccounts, 1);
    assert.match(result.text, /监控池：账号池 1 \| 近90天视频 1/u);
    assert.match(result.text, /white_alpha/u);
    assert.doesNotMatch(result.text, /legacy_alpha/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("sendMonitorReport sends one Feishu report message and writes a report log", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-send-"));
  const calls = [];
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]\n");
    await writeFile(path.join(dataDir, "seeds", "shops.json"), "[]\n");
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");

    const result = await sendMonitorReport({
      dataDir,
      now: new Date("2026-05-10T12:00:00.000Z"),
      alertMode: "dm",
      alertRecipient: "ou_test_user",
      notifier: {
        async send(message) {
          calls.push(message);
          return { status: "sent", messageId: "om_report" };
        }
      }
    });

    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /TikTok同行晨会简报/u);
    assert.doesNotMatch(calls[0].text, /候选账号/u);

    const reportLog = (await readFile(path.join(dataDir, "reports", "reports.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(reportLog.length, 1);
    assert.equal(reportLog[0].recipient, "ou_test_user");
    assert.equal(reportLog[0].messageId, "om_report");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
