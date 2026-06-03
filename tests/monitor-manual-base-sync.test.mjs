import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhitelistManualTableRows,
  classifyIncrementWindow,
  classifyIncrementWindows,
  planArchiveRowChanges,
  planLikesRowChanges,
  planIncrementRowChanges
} from "../src/monitor/manual-base-sync.mjs";

test("buildWhitelistManualTableRows maps whitelist dashboard videos into the three current Base result tables", () => {
  const rows = buildWhitelistManualTableRows({
    dashboardRecords: {
      videos: [
        {
          fields: {
            "账号名": "alpha",
            "来源表": "People Skills",
            "视频链接": "[查看视频](https://www.tiktok.com/@alpha/video/1)",
            "发布时间": "2026-05-28 09:00:00",
            "更新时间": "2026-05-28 12:00:00",
            "上次更新时间": "2026-05-28 10:00:00",
            "当前播放": 6200,
            "当前点赞": 2400,
            "当前评论": 55,
            "当前转发": 88,
            "播放增量": 5200,
            "点赞增量": 400,
            "评论增量": 10,
            "转发增量": 18
          }
        },
        {
          fields: {
            "账号名": "beta",
            "来源表": "Raise Children",
            "视频链接": "[查看视频](https://www.tiktok.com/@beta/video/2)",
            "发布时间": "2026-05-27 09:00:00",
            "更新时间": "2026-05-28 12:00:00",
            "上次更新时间": "",
            "当前播放": 900,
            "当前点赞": 300,
            "当前评论": 9,
            "当前转发": 12,
            "播放增量": 0,
            "点赞增量": 0,
            "评论增量": 0,
            "转发增量": 0
          }
        }
      ]
    }
  });

  assert.equal(rows.archive.length, 2);
  assert.equal(rows.likes.length, 1);
  assert.equal(rows.increments.length, 1);
  assert.equal(rows.archive[0]["视频链接"], "https://www.tiktok.com/@alpha/video/1");
  assert.equal(rows.archive[0]["更新时间"], "2026-05-28 12:00:00");
  assert.equal(rows.likes[0]["点赞量"], 2400);
  assert.equal(rows.likes[0]["来源品表"], "People Skills");
  assert.equal(rows.increments[0]["上次更新时间"], "2026-05-28 10:00:00");
  assert.equal(rows.increments[0]["记录类型"], "最新");
  assert.equal(rows.increments[0]["商品"], "People Skills");
  assert.equal(rows.increments[0]["间隔小时"], 2);
  assert.equal(rows.increments[0]["播放增量"], 5200);
  assert.equal(rows.increments[0]["每小时播放增量"], 2600);
  assert.match(rows.increments[0]["起量数据"], /近2个小时，新增5200播放/);
});

test("buildWhitelistManualTableRows uses a single descriptive increment headline instead of fixed buckets", () => {
  const rows = buildWhitelistManualTableRows({
    dashboardRecords: {
      videos: [
        {
          fields: {
            "账号名": "alpha",
            "来源表": "People Skills",
            "视频链接": "[查看视频](https://www.tiktok.com/@alpha/video/1)",
            "发布时间": "2026-05-28 09:00:00",
            "更新时间": "2026-05-28 12:00:00",
            "上次更新时间": "2026-05-28 10:00:00",
            "当前播放": 6200,
            "当前点赞": 2400,
            "当前评论": 55,
            "当前转发": 88,
            "播放增量": 5200,
            "点赞增量": 400,
            "评论增量": 10,
            "转发增量": 18
          }
        }
      ]
    }
  });

  assert.equal(rows.increments.length, 1);
  assert.equal(rows.increments[0]["商品"], "People Skills");
});

test("buildWhitelistManualTableRows suppresses increment rows for baseline sync and appends skipped high-like rows", () => {
  const rows = buildWhitelistManualTableRows({
    dashboardRecords: { videos: [] },
    skippedLikes: [
      {
        "账号": "legacy_skip",
        "视频链接": "https://www.tiktok.com/@legacy_skip/video/9",
        "发布时间": "2026-05-01 00:00:00",
        "来源品表": "People Skills",
        "播放量": 12000,
        "点赞量": 3200,
        "评论数": 20,
        "转发数": 60
      }
    ],
    suppressIncrements: true
  });

  assert.equal(rows.archive.length, 0);
  assert.equal(rows.likes.length, 1);
  assert.equal(rows.likes[0]["账号"], "legacy_skip");
  assert.equal(rows.increments.length, 0);
});

test("buildWhitelistManualTableRows dedupes like rows by logical video key before syncing leaderboard rows", () => {
  const rows = buildWhitelistManualTableRows({
    dashboardRecords: { videos: [] },
    skippedLikes: [
      {
        "账号": "dup-a",
        "视频链接": "[查看视频](https://www.tiktok.com/@dup/video/9)",
        "发布时间": "2026-05-01 00:00:00",
        "来源品表": "Raise Children",
        "播放量": 12000,
        "点赞量": 3200,
        "评论数": 20,
        "转发数": 60
      },
      {
        "账号": "dup-b",
        "视频链接": "https://www.tiktok.com/@dup/video/9",
        "发布时间": "2026-05-01 00:00:00",
        "来源品表": "Raise Children",
        "播放量": 12500,
        "点赞量": 3300,
        "评论数": 25,
        "转发数": 65
      }
    ],
    suppressIncrements: true
  });

  assert.equal(rows.likes.length, 1);
  assert.equal(rows.likes[0]["点赞量"], 3300);
});

test("planArchiveRowChanges keeps one row per video and updates metrics in place", () => {
  const changes = planArchiveRowChanges({
    existingRows: [
      {
        __recordId: "rec-archive-1",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 12:00:00",
        "播放量": 1000,
        "点赞量": 50,
        "评论数": 1,
        "转发数": 2
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 14:00:00",
        "播放量": 1200,
        "点赞量": 80,
        "评论数": 3,
        "转发数": 5
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds, []);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-archive-1");
  assert.equal(changes.updateRows[0].row["更新时间"], "2026-05-28 14:00:00");
  assert.equal(changes.updateRows[0].row["播放量"], 1200);
  assert.equal(changes.rowsToInsert.length, 0);
});

test("classifyIncrementWindow describes real elapsed hours and only requires 1k+ view growth", () => {
  assert.equal(
    classifyIncrementWindow({
      previousUpdatedAt: "2026-05-28 09:00:00",
      updatedAt: "2026-05-28 11:00:00",
      viewsDelta: 1200,
      sourceTable: "People Skills"
    }),
    "People Skills"
  );
  assert.equal(
    classifyIncrementWindow({
      previousUpdatedAt: "2026-05-28 09:00:00",
      updatedAt: "2026-05-28 14:00:00",
      viewsDelta: 6000,
      sourceTable: "Raise Children"
    }),
    "Raise Children"
  );
  assert.equal(
    classifyIncrementWindow({
      previousUpdatedAt: "2026-05-28 09:00:00",
      updatedAt: "2026-05-28 20:00:00",
      viewsDelta: 12000,
      sourceTable: "Make More Money"
    }),
    "Make More Money"
  );
  assert.equal(
    classifyIncrementWindow({
      previousUpdatedAt: "2026-05-28 09:00:00",
      updatedAt: "2026-05-28 20:00:00",
      viewsDelta: 999
    }),
    ""
  );
});

test("classifyIncrementWindows keeps rows with long gaps as long as view growth reaches 1k+", () => {
  assert.deepEqual(
    classifyIncrementWindows({
      previousUpdatedAt: "2026-05-29 01:49:51",
      updatedAt: "2026-05-30 02:51:49",
      viewsDelta: 5100,
      sourceTable: "People Skills"
    }),
    ["People Skills"]
  );
  assert.deepEqual(
    classifyIncrementWindows({
      previousUpdatedAt: "2026-05-29 01:49:51",
      updatedAt: "2026-05-30 02:51:49",
      viewsDelta: 999
    }),
    []
  );
});

test("planIncrementRowChanges keeps only the latest increment row for the same video", () => {
  const changes = planIncrementRowChanges({
    existingRows: [
      {
        __recordId: "rec-old-1",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 12:00:00",
        "上次更新时间": "2026-05-28 10:00:00",
        "记录类型": "最新",
        "商品": "People Skills"
      },
      {
        __recordId: "rec-old-2",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 14:00:00",
        "上次更新时间": "2026-05-28 12:00:00",
        "记录类型": "历史",
        "商品": "People Skills"
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 16:00:00",
        "上次更新时间": "2026-05-28 14:00:00",
        "记录类型": "最新",
        "商品": "People Skills"
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds.sort(), ["rec-old-1"]);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-old-2");
  assert.equal(changes.updateRows[0].row["记录类型"], "历史");
  assert.equal(changes.rowsToInsert.length, 1);
  assert.equal(changes.rowsToInsert[0]["记录类型"], "最新");
  assert.equal(changes.rowsToInsert[0]["更新时间"], "2026-05-28 16:00:00");
});

test("planIncrementRowChanges updates the latest increment row in place when wording changes but timestamps do not", () => {
  const changes = planIncrementRowChanges({
    existingRows: [
      {
        __recordId: "rec-old-1",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 16:00:00",
        "上次更新时间": "2026-05-28 14:00:00",
        "记录类型": "最新",
        "增量档位": "3小时新增1k播放",
        "增量说明": "近2小时内新增5200播放"
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 16:00:00",
        "上次更新时间": "2026-05-28 14:00:00",
        "记录类型": "最新",
        "商品": "People Skills",
        "起量数据": "近2个小时，新增5200播放，点赞+55，评论+0，转发+12",
        "每小时播放增量": 2600
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds, []);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-old-1");
  assert.equal(changes.rowsToInsert.length, 0);
});

test("planIncrementRowChanges keeps only one recent history row per video", () => {
  const changes = planIncrementRowChanges({
    existingRows: [
      {
        __recordId: "rec-latest",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 16:00:00",
        "上次更新时间": "2026-05-28 14:00:00",
        "记录类型": "最新",
        "商品": "People Skills"
      },
      {
        __recordId: "rec-history-old",
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 14:00:00",
        "上次更新时间": "2026-05-28 12:00:00",
        "记录类型": "历史",
        "商品": "People Skills"
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "更新时间": "2026-05-28 18:00:00",
        "上次更新时间": "2026-05-28 16:00:00",
        "记录类型": "最新",
        "商品": "People Skills"
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds, ["rec-history-old"]);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-latest");
  assert.equal(changes.updateRows[0].row["记录类型"], "历史");
  assert.equal(changes.rowsToInsert.length, 1);
  assert.equal(changes.rowsToInsert[0]["记录类型"], "最新");
});

test("planLikesRowChanges deletes duplicate like rows and updates survivor to current metrics", () => {
  const changes = planLikesRowChanges({
    existingRows: [
      {
        __recordId: "rec-old-1",
        "账号": "alpha",
        "来源品表": "People Skills",
        "视频链接": "[查看视频](https://www.tiktok.com/@alpha/video/1)",
        "发布时间": "2026-05-28 09:00:00",
        "播放量": 12000,
        "点赞量": 2100,
        "评论数": 30,
        "转发数": 80
      },
      {
        __recordId: "rec-old-2",
        "账号": "alpha",
        "来源品表": "People Skills",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "播放量": 14000,
        "点赞量": 2200,
        "评论数": 35,
        "转发数": 90
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "来源品表": "People Skills",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "播放量": 15000,
        "点赞量": 2500,
        "评论数": 40,
        "转发数": 100
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds, ["rec-old-1"]);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-old-2");
  assert.equal(changes.updateRows[0].row["点赞量"], 2500);
});

test("planLikesRowChanges treats ISO and local published-at formats as the same logical video key", () => {
  const changes = planLikesRowChanges({
    existingRows: [
      {
        __recordId: "rec-old-1",
        "账号": "alpha",
        "来源品表": "Raise Children",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28 09:00:00",
        "播放量": 12000,
        "点赞量": 2100,
        "评论数": 30,
        "转发数": 80
      }
    ],
    incomingRows: [
      {
        "账号": "alpha",
        "来源品表": "Raise Children",
        "视频链接": "https://www.tiktok.com/@alpha/video/1",
        "发布时间": "2026-05-28T09:00:00.000Z",
        "播放量": 15000,
        "点赞量": 2500,
        "评论数": 40,
        "转发数": 100
      }
    ]
  });

  assert.deepEqual(changes.deleteRecordIds, []);
  assert.equal(changes.updateRows.length, 1);
  assert.equal(changes.updateRows[0].recordId, "rec-old-1");
});
