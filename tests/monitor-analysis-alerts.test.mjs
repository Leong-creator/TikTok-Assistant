import assert from "node:assert/strict";
import test from "node:test";

import { buildLarkCliInvocation, createFeishuNotifier, dedupeAlertSignals } from "../src/monitor/alerts.mjs";
import {
  analyzeProductSnapshots,
  analyzeVideoSnapshots,
  selectCollectionTargets
} from "../src/monitor/analyzer.mjs";

test("selectCollectionTargets excludes accounts stale for more than sixty days", () => {
  const selected = selectCollectionTargets({
    now: new Date("2026-05-09T12:00:00+08:00"),
    staleAccountDays: 60,
    accounts: [
      {
        id: "active-account",
        handle: "active_books",
        profileUrl: "https://www.tiktok.com/@active_books",
        lastKnownPostAt: "2026-05-01T00:00:00+08:00",
        enabled: true
      },
      {
        id: "stale-account",
        handle: "stale_books",
        profileUrl: "https://www.tiktok.com/@stale_books",
        lastKnownPostAt: "2026-02-01T00:00:00+08:00",
        enabled: true
      }
    ],
    shops: []
  });

  assert.deepEqual(selected.accounts.map((account) => account.handle), ["active_books"]);
  assert.deepEqual(selected.staleAccounts.map((account) => account.handle), ["stale_books"]);
  assert.equal(selected.staleAccounts[0].staleReason, "last post is 97 days old");
});

test("alerts buildLarkCliInvocation quotes absolute Windows lark-cli paths", () => {
  const invocation = buildLarkCliInvocation({
    platform: "win32",
    larkCliPath: "C:\\Users\\EDY\\AppData\\Roaming\\npm\\lark-cli.cmd",
    args: ["im", "+messages-send"]
  });

  assert.equal(invocation.command, "node");
  assert.match(invocation.args[0], /node_modules[\\/]@larksuite[\\/]cli[\\/]scripts[\\/]run\.js$/u);
  assert.deepEqual(invocation.args.slice(1), ["im", "+messages-send"]);
});

test("analyzeVideoSnapshots creates a lead-worthy signal for fast six-hour growth", () => {
  const snapshots = [
    {
      collectedAt: "2026-05-09T00:00:00.000Z",
      source: "mock",
      accountHandle: "book_alpha",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      caption: "A book lesson about money habits",
      postedAt: "2026-05-08T20:00:00.000Z",
      views: 1000,
      likes: 20,
      comments: 1,
      shares: 1,
      productRefs: []
    },
    {
      collectedAt: "2026-05-09T06:00:00.000Z",
      source: "mock",
      accountHandle: "book_alpha",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      caption: "A book lesson about money habits",
      postedAt: "2026-05-08T20:00:00.000Z",
      views: 4600,
      likes: 95,
      comments: 9,
      shares: 6,
      productRefs: []
    }
  ];

  const signals = analyzeVideoSnapshots(snapshots, {
    now: new Date("2026-05-09T06:00:00.000Z"),
    min6hViews: 3000,
    min24hViews: 10000
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].entityType, "video");
  assert.equal(signals[0].entityUrl, "https://www.tiktok.com/@book_alpha/video/1");
  assert.equal(signals[0].deltas.views, 3600);
  assert.equal(signals[0].windowHours, 6);
  assert.equal(signals[0].signalKind, "new_breakout");
  assert.equal(signals[0].signalLabel, "3天内新爆");
  assert.ok(signals[0].score >= 70);
  assert.ok(signals[0].reasons.some((reason) => /6h views \+3600/.test(reason)));
  assert.equal(signals[0].recommendedAction, "create_lead");
  assert.match(signals[0].operatorAction, /优先拆解/u);
});

test("analyzeVideoSnapshots creates a signal for fast three-hour view growth", () => {
  const snapshots = [
    {
      collectedAt: "2026-05-09T00:00:00.000Z",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      accountHandle: "book_alpha",
      views: 1000,
      likes: 20,
      comments: 1,
      shares: 1
    },
    {
      collectedAt: "2026-05-09T03:00:00.000Z",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      accountHandle: "book_alpha",
      views: 4300,
      likes: 120,
      comments: 12,
      shares: 15
    }
  ];

  const signals = analyzeVideoSnapshots(snapshots, {
    now: new Date("2026-05-09T03:00:00.000Z"),
    min3hViews: 3000,
    min24hViews: 10000
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].windowHours, 3);
  assert.equal(signals[0].deltas.views, 3300);
  assert.equal(signals[0].signalLabel, "3天内新爆");
  assert.ok(signals[0].reasons.some((reason) => /3h views \+3300/.test(reason)));
});

test("analyzeVideoSnapshots falls back to interaction growth when views are unavailable", () => {
  const snapshots = [
    {
      collectedAt: "2026-05-09T00:00:00.000Z",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      accountHandle: "book_alpha",
      views: 0,
      likes: 1000,
      comments: 20,
      shares: 30
    },
    {
      collectedAt: "2026-05-09T03:00:00.000Z",
      videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
      accountHandle: "book_alpha",
      views: 0,
      likes: 4300,
      comments: 160,
      shares: 700
    }
  ];

  const signals = analyzeVideoSnapshots(snapshots, {
    now: new Date("2026-05-09T03:00:00.000Z"),
    min3hViews: 3000,
    min3hLikes: 3000,
    min3hShares: 500,
    min3hComments: 100
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].deltas.likes, 3300);
  assert.equal(signals[0].deltas.comments, 140);
  assert.equal(signals[0].deltas.shares, 670);
  assert.equal(signals[0].signalKind, "new_breakout");
  assert.ok(signals[0].reasons.some((reason) => /interaction fallback/i.test(reason)));
});

test("analyzeProductSnapshots creates signals for shop product sales growth", () => {
  const snapshots = [
    {
      collectedAt: "2026-05-09T00:00:00.000Z",
      source: "mock",
      shopName: "Alpha Books",
      productUrl: "https://www.tiktok.com/shop/p/alpha",
      title: "Money Habits Book",
      price: 19.99,
      soldCount: 12,
      reviewCount: 3,
      rating: 4.6
    },
    {
      collectedAt: "2026-05-09T06:00:00.000Z",
      source: "mock",
      shopName: "Alpha Books",
      productUrl: "https://www.tiktok.com/shop/p/alpha",
      title: "Money Habits Book",
      price: 18.99,
      soldCount: 37,
      reviewCount: 7,
      rating: 4.7
    }
  ];

  const signals = analyzeProductSnapshots(snapshots, {
    now: new Date("2026-05-09T06:00:00.000Z")
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].entityType, "product");
  assert.equal(signals[0].deltas.soldCount, 25);
  assert.equal(signals[0].deltas.reviewCount, 4);
  assert.equal(signals[0].deltas.price, -1);
  assert.ok(signals[0].reasons.includes("sold count +25"));
});

test("dedupeAlertSignals blocks repeat alerts unless score increases", () => {
  const now = new Date("2026-05-09T12:00:00.000Z");
  const previousAlerts = [
    {
      sentAt: "2026-05-09T04:00:00.000Z",
      entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
      score: 72,
      status: "sent"
    }
  ];

  const repeated = dedupeAlertSignals({
    now,
    signals: [
      {
        entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
        score: 72
      }
    ],
    previousAlerts
  });
  assert.equal(repeated.toSend.length, 0);
  assert.equal(repeated.skipped.length, 1);

  const escalated = dedupeAlertSignals({
    now,
    signals: [
      {
        entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
        score: 91
      }
    ],
    previousAlerts
  });
  assert.equal(escalated.toSend.length, 1);
  assert.equal(escalated.skipped.length, 0);
});

test("createFeishuNotifier sends Feishu DM through lark-cli user-id arguments", async () => {
  const calls = [];
  const notifier = createFeishuNotifier({
    mode: "dm",
    dmOpenId: "ou_test_user",
    larkCliPath: "lark-cli",
    platform: "linux",
    execFileImpl: async (...args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ ok: true, data: { message_id: "om_test" } }) };
    }
  });

  const result = await notifier.send({
    text: "TikTok monitor test",
    signal: { entityUrl: "https://www.tiktok.com/@book/video/1" }
  });

  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "om_test");
  assert.equal(calls[0][0], "lark-cli");
  assert.deepEqual(calls[0][1].slice(0, 4), ["im", "+messages-send", "--as", "bot"]);
  assert.ok(calls[0][1].includes("--user-id"));
  assert.ok(calls[0][1].includes("ou_test_user"));
  assert.ok(calls[0][1].includes("--text"));
  assert.equal(calls[0][1][calls[0][1].indexOf("--text") + 1], "TikTok monitor test");
});

test("createFeishuNotifier wraps lark-cli through cmd on Windows", async () => {
  const calls = [];
  const notifier = createFeishuNotifier({
    mode: "dm",
    dmOpenId: "ou_test_user",
    larkCliPath: "lark-cli.cmd",
    platform: "win32",
    execFileImpl: async (...args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ ok: true, data: { message_id: "om_test" } }) };
    }
  });

  await notifier.send({
    text: "TikTok monitor test\nsecond line",
    signal: { entityUrl: "https://www.tiktok.com/@book/video/1" }
  });

  assert.equal(calls[0][0], "node");
  assert.match(calls[0][1][0], /node_modules[\\/]@larksuite[\\/]cli[\\/]scripts[\\/]run\.js$/u);
  assert.ok(calls[0][1].includes("--text"));
  assert.equal(calls[0][1][calls[0][1].indexOf("--text") + 1], "TikTok monitor test\nsecond line");
});
