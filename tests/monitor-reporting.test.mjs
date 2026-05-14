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
          windowHours: 3,
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

    assert.equal(result.summary.trackedAccounts, 2);
    assert.equal(result.summary.candidateAccounts, 1);
    assert.equal(result.summary.trackedShops, 1);
    assert.equal(result.summary.recentSignals, 1);
    assert.equal(result.summary.topSignals.length, 1);
    assert.match(result.text, /TikTok运营监控简报/u);
    assert.match(result.text, /监控池：正式账号 2 \| 候选账号 1 \| 商品入口 1/u);
    assert.match(result.text, /今日结论：/u);
    assert.match(result.text, /近24小时发现 1 条值得跟进的突增内容/u);
    assert.match(result.text, /重点跟进内容：/u);
    assert.match(result.text, /book_alpha/u);
    assert.match(result.text, /播放\+3600/u);
    assert.match(result.text, /点赞\+200/u);
    assert.match(result.text, /建议动作：/u);
    assert.match(result.text, /https:\/\/example.com\/base\/monitor/u);
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
        windowHours: 6,
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
    assert.match(result.text, /近24小时暂未发现新的突增内容/u);
    assert.match(result.text, /最近一次值得参考的突增内容/u);
    assert.match(result.text, /播放\+5200/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport falls back to historical run snapshots when the root snapshot folder is empty", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-report-run-fallback-"));
  try {
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
          videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
          views: 1000,
          likes: 50,
          comments: 5,
          shares: 3
        }),
        JSON.stringify({
          collectedAt: "2026-05-10T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
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
    assert.match(result.text, /数据覆盖：已采集 1 条视频/u);
    assert.match(result.text, /播放\+3500/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildMonitorReport includes top recent seven-day published videos even when no surge exists", async () => {
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
    assert.equal(result.summary.topRecentPublishedVideos.length, 2);
    assert.equal(result.summary.topRecentPublishedVideos[0].accountHandle, "book_alpha");
    assert.match(result.text, /近24小时暂未发现新的突增内容/u);
    assert.match(result.text, /近7天值得关注的新发视频/u);
    assert.match(result.text, /book_alpha/u);
    assert.match(result.text, /book_gamma/u);
    assert.doesNotMatch(result.text, /book_beta/u);
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
    assert.match(calls[0].text, /TikTok运营监控简报/u);

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
