import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBaseDashboardRecords, refreshFeishuBaseRecordMap, syncFeishuBaseDashboard } from "../src/monitor/base-dashboard.mjs";

test("buildBaseDashboardRecords creates dashboard rows for accounts, videos, signals, and products", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-records-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify([
        {
          handle: "candidate_books",
          profileUrl: "https://www.tiktok.com/@candidate_books",
          sourceQuery: "People Skills book",
          relatedBooks: ["people_skills"],
          hasCommerce: true,
          status: "candidate"
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T12:00:00.000Z",
        accountHandle: "book_alpha",
        videoUrl: "https://www.tiktok.com/@book_alpha/video/1",
        views: 12000,
        likes: 1000,
        comments: 30,
        shares: 50,
        productRefs: ["https://www.tiktok.com/shop/p/people-skills"]
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: "https://www.tiktok.com/@book_alpha/video/1",
        accountHandle: "book_alpha",
        windowHours: 3,
        deltas: { views: 3300, likes: 500, comments: 10, shares: 20 },
        score: 88,
        recommendedAction: "create_lead"
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T12:00:00.000Z",
        shopName: "Book Seller",
        productUrl: "https://www.tiktok.com/shop/p/people-skills",
        title: "People Skills",
        price: 19.99,
        soldCount: 100,
        reviewCount: 12,
        rating: 4.8
      }) + "\n"
    );

    const records = await buildBaseDashboardRecords({ dataDir });

    assert.equal(records.accounts.length, 2);
    assert.equal(records.videos.length, 1);
    assert.equal(records.signals.length, 1);
    assert.equal(records.products.length, 1);
    assert.equal(records.accounts[0].fields["账号"], "book_alpha");
    assert.equal(records.accounts[0].fields["最近视频数"], 1);
    assert.equal(records.accounts[1].fields["状态"], "候选");
    assert.equal(records.videos[0].fields["播放"], 12000);
    assert.equal(records.signals[0].fields["信号键"], "https://www.tiktok.com/@book_alpha/video/1-3");
    assert.equal(records.signals[0].fields["播放增量"], 3300);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseDashboard dry run returns lark-cli base upsert plan", async () => {
  const result = await syncFeishuBaseDashboard({
    records: {
      accounts: [{ fields: { "账号": "book_alpha" }, key: "book_alpha" }],
      videos: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1" }, key: "video-1" }],
      signals: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1", "评分": 88 }, key: "signal-1" }],
      products: [{ fields: { "商品链接": "https://www.tiktok.com/shop/p/1" }, key: "product-1" }]
    },
    baseToken: "app_test",
    tableMap: {
      accounts: "tbl_accounts",
      videos: "tbl_videos",
      signals: "tbl_signals",
      products: "tbl_products"
    },
    dryRun: true
  });

  assert.equal(result.commands.length, 4);
  assert.ok(result.commands.every((command) => command.args[0] === "base"));
  assert.ok(result.commands.every((command) => command.args[1] === "+record-upsert"));
  assert.ok(result.commands.every((command) => command.args.includes("--json")));
});

test("syncFeishuBaseDashboard falls back to monitoring_data base_dashboard_config.json", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-config-fallback-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "book_alpha", profileUrl: "https://www.tiktok.com/@book_alpha", enabled: true }])
    );
    await writeFile(
      path.join(dataDir, "base_dashboard_config.json"),
      JSON.stringify({
        baseToken: "app_from_config",
        tableMap: { accounts: "tbl_accounts" }
      })
    );

    const result = await syncFeishuBaseDashboard({
      dataDir,
      dryRun: true
    });

    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].args.includes("app_from_config"), true);
    assert.equal(result.commands[0].args.includes("tbl_accounts"), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseDashboard reuses cached record ids to avoid duplicate dashboard rows", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-map-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  const invocations = [];
  try {
    await writeFile(
      recordMapPath,
      JSON.stringify({
        "videos:tbl_videos:video-1": {
          recordId: "rec_video_1",
          kind: "videos",
          tableId: "tbl_videos",
          rowKey: "video-1"
        }
      })
    );

    await syncFeishuBaseDashboard({
      dataDir,
      recordMapPath,
      records: {
        accounts: [{ fields: { "账号": "book_alpha" }, key: "book_alpha" }],
        videos: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1" }, key: "video-1" }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos"
      },
      platform: "linux",
      larkCliPath: "lark-cli",
      refreshRecordMap: false,
      async execFileImpl(command, args) {
        invocations.push({ command, args });
        const kind = args.includes("tbl_accounts") ? "account" : "video";
        return { stdout: JSON.stringify({ record: { record_id: `rec_${kind}` } }) };
      }
    });

    const accountArgs = invocations.find((item) => item.args.includes("tbl_accounts")).args;
    const videoArgs = invocations.find((item) => item.args.includes("tbl_videos")).args;
    assert.equal(accountArgs.includes("--record-id"), false);
    assert.equal(videoArgs.includes("--record-id"), true);
    assert.equal(videoArgs[videoArgs.indexOf("--record-id") + 1], "rec_video_1");

    const updatedMap = JSON.parse(await readFile(recordMapPath, "utf8"));
    assert.equal(updatedMap["accounts:tbl_accounts:book_alpha"].recordId, "rec_account");
    assert.equal(updatedMap["videos:tbl_videos:video-1"].recordId, "rec_video");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseDashboard refreshes Base ids before upsert when the local record map is empty", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-pre-refresh-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  const invocations = [];
  try {
    await syncFeishuBaseDashboard({
      dataDir,
      recordMapPath,
      records: {
        accounts: [{ fields: { "账号": "book_alpha" }, key: "book_alpha" }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts"
      },
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        invocations.push({ command, args });
        if (args[1] === "+record-list") {
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["账号"],
                data: [["book_alpha"]],
                record_id_list: ["rec_existing"]
              }
            })
          };
        }
        return { stdout: JSON.stringify({ record: { record_id: "rec_existing" } }) };
      }
    });

    const upsert = invocations.find((item) => item.args[1] === "+record-upsert");
    assert.ok(upsert);
    assert.equal(upsert.args.includes("--record-id"), true);
    assert.equal(upsert.args[upsert.args.indexOf("--record-id") + 1], "rec_existing");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("refreshFeishuBaseRecordMap rebuilds row cache from Base record-list output", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-refresh-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  try {
    const result = await refreshFeishuBaseRecordMap({
      dataDir,
      recordMapPath,
      records: {
        accounts: [{ fields: { "账号": "book_alpha" }, key: "book_alpha" }],
        videos: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1" }, key: "https://www.tiktok.com/@book/video/1" }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos"
      },
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        if (args.includes("tbl_accounts")) {
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["账号"],
                data: [["book_alpha"]],
                record_id_list: ["rec_account"]
              }
            })
          };
        }
        return {
          stdout: JSON.stringify({
            data: {
              fields: ["视频链接"],
              data: [["[https://www.tiktok.com/@book/video/1](https://www.tiktok.com/@book/video/1)"]],
              record_id_list: ["rec_video"]
            }
          })
        };
      }
    });

    assert.equal(result.mappedRecordCount, 2);
    const map = JSON.parse(await readFile(recordMapPath, "utf8"));
    assert.equal(map["accounts:tbl_accounts:book_alpha"].recordId, "rec_account");
    assert.equal(map["videos:tbl_videos:https://www.tiktok.com/@book/video/1"].recordId, "rec_video");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
