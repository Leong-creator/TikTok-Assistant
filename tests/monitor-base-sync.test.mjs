import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBaseDashboardRecords, refreshFeishuBaseRecordMap, syncFeishuBaseDashboard, syncFeishuBaseSchema } from "../src/monitor/base-dashboard.mjs";

test("buildBaseDashboardRecords builds a unified account pool and 90-day video material rows", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-records-"));
  try {
    const validVideoUrl = "https://www.tiktok.com/@book_alpha/video/7623225588626590990";
    const validVideoUrlNoCommerce = "https://www.tiktok.com/@book_alpha/video/7624000000000000000";
    const recentPostedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const oldPostedAt = new Date(Date.now() - 120 * 86_400_000).toISOString();
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
      [
        JSON.stringify({
          collectedAt: "2026-05-09T09:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: validVideoUrl,
          postedAt: recentPostedAt,
          views: 8700,
          likes: 780,
          comments: 24,
          shares: 32,
          productRefs: [{ productUrl: "https://www.tiktok.com/shop/p/people-skills", shopUrl: "https://www.tiktok.com/shop/book-seller" }]
        }),
        JSON.stringify({
          collectedAt: "2026-05-09T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: validVideoUrl,
          postedAt: recentPostedAt,
          views: 12000,
          likes: 1000,
          comments: 30,
          shares: 50,
          productRefs: [{ productUrl: "https://www.tiktok.com/shop/p/people-skills", shopUrl: "https://www.tiktok.com/shop/book-seller" }]
        }),
        JSON.stringify({
          collectedAt: "2026-05-09T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: validVideoUrlNoCommerce,
          postedAt: recentPostedAt,
          views: 6400,
          likes: 320,
          comments: 12,
          shares: 18,
          caption: "Read people skills and learn the kind of people wisdom that can change how you talk and think.",
          productRefs: []
        }),
        JSON.stringify({
          collectedAt: "2026-05-09T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/old",
          postedAt: oldPostedAt,
          views: 54000,
          likes: 2100,
          comments: 120,
          shares: 180,
          productRefs: []
        }),
        JSON.stringify({
          collectedAt: "2026-05-09T12:00:00.000Z",
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/1622962893630470",
          postedAt: recentPostedAt,
          views: 99999,
          likes: 9999,
          comments: 999,
          shares: 999,
          productRefs: []
        })
      ].join("\n") + "\n"
    );
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: validVideoUrl,
        accountHandle: "book_alpha",
        signalKind: "new_breakout",
        signalLabel: "3天内新爆",
        operatorAction: "优先拆解开头钩子、题材切口和评论区反馈。",
        windowHours: 3,
        current: {
          videoUrl: validVideoUrl,
          postedAt: recentPostedAt
        },
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
    assert.equal(records.videos.length, 2);
    assert.equal(records.themes.length, 1);
    assert.equal(records.accounts[0].fields["账号"], "book_alpha");
    assert.equal(records.accounts[0].fields["账号排名"], 1);
    assert.ok(!Object.hasOwn(records.accounts[0].fields, "状态"));
    assert.equal(records.accounts[0].fields["重点等级"], "重点跟进");
    assert.equal(records.accounts[0].fields["最近爆点标签"], "3天内新爆");
    assert.equal(records.accounts[0].fields["近期主打主题"], "people skills");
    assert.match(records.accounts[0].fields["最新爆点视频"], /\[查看视频\]\(https:\/\/www\.tiktok\.com\/@book_alpha\/video\/7623225588626590990\)/u);
    assert.ok(records.accounts[0].fields["最近发文时间"]);
    assert.equal(records.accounts[0].fields["近7天好素材数"], 1);
    assert.equal(records.accounts[0].fields["账号热度分"] > 0, true);
    assert.equal(records.accounts[1].fields["账号"], "candidate_books");
    assert.equal(records.accounts[1].fields["重点等级"], "普通观察");
    assert.equal(records.accounts[1].fields["近期主打主题"], "people skills");
    assert.equal(records.videos[0].fields["播放"], 12000);
    assert.equal(records.videos[0].fields["视频榜排名"], 1);
    assert.equal(records.videos[0].fields["预警排名"], 1);
    assert.match(records.videos[0].fields["视频链接"], /\[book_alpha｜people skills｜/u);
    assert.match(records.videos[0].fields["视频链接"], /\(https:\/\/www\.tiktok\.com\/@book_alpha\/video\/7623225588626590990\)/u);
    assert.ok(records.videos[0].fields["发布时间"]);
    assert.equal(records.videos[0].fields["发布时间窗"], "0-3天");
    assert.equal(records.videos[0].fields["榜单标签"], "3天内新爆");
    assert.equal(records.videos[0].fields["24h播放增量"], 3300);
    assert.equal(records.videos[0].fields["运营热度分"] > 0, true);
    assert.match(records.videos[0].fields["上榜原因"], /24h播放\+3,300/u);
    assert.equal(records.videos[0].fields["当前是否带货"], true);
    assert.equal(records.videos[0].fields["主推商品"], "People Skills");
    assert.equal(records.videos[0].fields["商品主题"], "people skills");
    assert.equal(records.videos[0].fields["主题参考分"] > 0, true);
    assert.match(records.videos[0].fields["主题参考原因"], /3天内新爆|点赞过千/u);
    assert.equal(records.videos[0].fields["店铺"], "Book Seller");
    assert.equal(records.videos[0].fields["商品链接"], "https://www.tiktok.com/shop/p/people-skills");
    assert.deepEqual(records.videos[0].links["所属账号"], [{ kind: "accounts", rowKey: "book_alpha" }]);
    const fallbackThemeVideo = records.videos.find((record) => record.key === validVideoUrlNoCommerce);
    assert.ok(fallbackThemeVideo);
    assert.equal(fallbackThemeVideo.fields["商品主题"], "people skills");
    assert.equal(records.themes[0].fields["主题"], "people skills");
    assert.equal(records.themes[0].fields["主题排名"], 1);
    assert.equal(records.themes[0].fields["近3个月收录视频数"], 2);
    assert.equal(records.themes[0].fields["高表现视频数"], 1);
    assert.match(records.themes[0].fields["代表账号"], /\[book_alpha\]\(https:\/\/www\.tiktok\.com\/@book_alpha\)/u);
    assert.ok(records.themes[0].fields["代表视频发布时间"]);
    assert.match(records.themes[0].fields["代表视频链接"], /\[查看代表视频\]\(https:\/\/www\.tiktok\.com\/@book_alpha\/video\/7623225588626590990\)/u);
    assert.equal(records.themes[0].fields["主题热度分"] > 0, true);
    assert.deepEqual(records.themes[0].links["关联视频"], [
      { kind: "videos", rowKey: validVideoUrl },
      { kind: "videos", rowKey: validVideoUrlNoCommerce }
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseDashboard dry run returns lark-cli base upsert plan", async () => {
  const result = await syncFeishuBaseDashboard({
      records: {
        accounts: [{ fields: { "账号": "book_alpha" }, key: "book_alpha" }],
        videos: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1" }, key: "video-1" }],
        themes: [{ fields: { "主题": "People Skills" }, key: "People Skills" }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos",
        themes: "tbl_themes"
      },
      dryRun: true
    });

  assert.equal(result.commands.length, 3);
  assert.ok(result.commands.every((command) => command.args[0] === "base"));
  assert.ok(result.commands.every((command) => command.args[1] === "+record-upsert"));
  assert.ok(result.commands.every((command) => command.args.includes("--json")));
});

test("syncFeishuBaseSchema dry run emits create/update commands for missing fields and views", async () => {
  const invocations = [];
  const result = await syncFeishuBaseSchema({
    baseToken: "app_test",
    tableMap: { accounts: "tbl_accounts", videos: "tbl_videos", themes: "tbl_themes" },
    dryRun: true,
    platform: "linux",
    larkCliPath: "lark-cli",
    async execFileImpl(command, args) {
      invocations.push({ command, args });
      if (args[1] === "+field-list") {
        if (args.includes("tbl_accounts")) {
          return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_account", name: "账号" }, { id: "fld_home", name: "主页" }] } }) };
        }
        if (args.includes("tbl_themes")) {
          return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_theme", name: "主题" }] } }) };
        }
        return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_video", name: "视频链接" }, { id: "fld_account_link", name: "所属账号" }] } }) };
      }
      if (args[1] === "+view-list") {
        return { stdout: JSON.stringify({ data: { views: [{ id: "viw_old", name: "账号雷达" }] } }) };
      }
      return { stdout: JSON.stringify({ ok: true }) };
    }
  });

  assert.equal(invocations.some((item) => item.args[1] === "+field-list"), true);
  assert.equal(invocations.some((item) => item.args[1] === "+view-list"), true);
  assert.equal(result.commands.some((item) => item.args[1] === "+table-update"), true);
  assert.equal(result.commands.some((item) => item.args[1] === "+field-create"), true);
  assert.equal(result.commands.some((item) => item.args[1] === "+view-create"), true);
  assert.equal(result.commands.some((item) => item.args[1] === "+view-set-visible-fields"), true);
  assert.equal(result.commands.some((item) => item.args[1] === "+view-delete"), true);
});

test("syncFeishuBaseSchema creates and persists missing theme table before applying schema", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-theme-table-"));
  const baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json");
  const invocations = [];
  const createdViewsByTable = new Map();
  try {
    await writeFile(
      baseDashboardConfigPath,
      JSON.stringify({
        baseToken: "app_test",
        tableMap: {
          accounts: "tbl_accounts",
          videos: "tbl_videos"
        }
      })
    );

    await syncFeishuBaseSchema({
      dataDir,
      baseDashboardConfigPath,
      dryRun: false,
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        invocations.push({ command, args });
        if (args[1] === "+table-list") {
          return { stdout: JSON.stringify({ data: { tables: [{ id: "tbl_accounts", name: "同行账号池" }, { id: "tbl_videos", name: "视频素材池" }] } }) };
        }
        if (args[1] === "+table-create") {
          return { stdout: JSON.stringify({ data: { table_id: "tbl_themes" } }) };
        }
        if (args[1] === "+field-list") {
          if (args.includes("tbl_accounts")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_account", name: "账号" }] } }) };
          if (args.includes("tbl_videos")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_video", name: "视频链接" }, { id: "fld_account_link", name: "所属账号" }] } }) };
          if (args.includes("tbl_themes")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_theme", name: "主题" }] } }) };
        }
        if (args[1] === "+view-list") {
          const tableId = args[args.indexOf("--table-id") + 1];
          const createdViews = createdViewsByTable.get(tableId) ?? [];
          return { stdout: JSON.stringify({ data: { views: createdViews } }) };
        }
        if (args[1] === "+view-create") {
          const tableId = args[args.indexOf("--table-id") + 1];
          const payload = JSON.parse(args[args.indexOf("--json") + 1]);
          const createdViews = createdViewsByTable.get(tableId) ?? [];
          createdViews.push({ id: `viw_${payload.name}`, name: payload.name });
          createdViewsByTable.set(tableId, createdViews);
          return { stdout: JSON.stringify({ ok: true }) };
        }
        return { stdout: JSON.stringify({ ok: true }) };
      }
    });

    const persisted = JSON.parse(await readFile(baseDashboardConfigPath, "utf8"));
    assert.equal(persisted.tableMap.themes, "tbl_themes");
    assert.equal(invocations.some((item) => item.args[1] === "+table-create" && item.args.includes("主题参考库")), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseSchema honors custom table names from config", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-custom-schema-"));
  const baseDashboardConfigPath = path.join(dataDir, "base_dashboard_whitelist_config.json");
  const invocations = [];
  const createdViewsByTable = new Map();
  try {
    await writeFile(
      baseDashboardConfigPath,
      JSON.stringify({
        baseToken: "app_test",
        tableNames: {
          accounts: "白名单追踪账号池",
          videos: "白名单追踪视频池",
          themes: "白名单主题参考库"
        },
        tableMap: {}
      })
    );

    await syncFeishuBaseSchema({
      dataDir,
      baseDashboardConfigPath,
      dryRun: false,
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        invocations.push({ command, args });
        if (args[1] === "+table-list") {
          return { stdout: JSON.stringify({ data: { tables: [] } }) };
        }
        if (args[1] === "+table-create") {
          const tableName = args[args.indexOf("--name") + 1];
          const createdId = tableName === "白名单追踪账号池"
            ? "tbl_accounts"
            : tableName === "白名单追踪视频池"
              ? "tbl_videos"
              : "tbl_themes";
          return { stdout: JSON.stringify({ data: { table_id: createdId } }) };
        }
        if (args[1] === "+field-list") {
          if (args.includes("tbl_accounts")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_account", name: "账号" }] } }) };
          if (args.includes("tbl_videos")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_video", name: "视频链接" }, { id: "fld_account_link", name: "所属账号" }] } }) };
          if (args.includes("tbl_themes")) return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_theme", name: "主题" }] } }) };
        }
        if (args[1] === "+view-list") {
          const tableId = args[args.indexOf("--table-id") + 1];
          return { stdout: JSON.stringify({ data: { views: createdViewsByTable.get(tableId) ?? [] } }) };
        }
        if (args[1] === "+view-create") {
          const tableId = args[args.indexOf("--table-id") + 1];
          const payload = JSON.parse(args[args.indexOf("--json") + 1]);
          const createdViews = createdViewsByTable.get(tableId) ?? [];
          createdViews.push({ id: `viw_${payload.name}`, name: payload.name });
          createdViewsByTable.set(tableId, createdViews);
          return { stdout: JSON.stringify({ ok: true }) };
        }
        return { stdout: JSON.stringify({ ok: true }) };
      }
    });

    const persisted = JSON.parse(await readFile(baseDashboardConfigPath, "utf8"));
    assert.deepEqual(persisted.tableNames, {
      accounts: "白名单追踪账号池",
      videos: "白名单追踪视频池",
      themes: "白名单主题参考库"
    });
    assert.deepEqual(persisted.tableMap, {
      accounts: "tbl_accounts",
      videos: "tbl_videos",
      themes: "tbl_themes"
    });
    assert.equal(invocations.some((item) => item.args[1] === "+table-create" && item.args.includes("白名单追踪账号池")), true);
    assert.equal(invocations.some((item) => item.args[1] === "+table-create" && item.args.includes("白名单追踪视频池")), true);
    assert.equal(invocations.some((item) => item.args[1] === "+table-create" && item.args.includes("白名单追踪主题参考库")), false);
    assert.equal(invocations.some((item) => item.args[1] === "+table-create" && item.args.includes("白名单主题参考库")), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildBaseDashboardRecords infers product theme from caption when product refs and source query are missing", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-caption-theme-"));
  try {
    const videoUrl = "https://www.tiktok.com/@caption_only/video/7642489390157139213";
    const postedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([{ handle: "caption_only", profileUrl: "https://www.tiktok.com/@caption_only", enabled: true }])
    );
    await writeFile(path.join(dataDir, "seeds", "account_candidates.json"), "[]");
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T12:00:00.000Z",
        accountHandle: "caption_only",
        videoUrl,
        postedAt,
        views: 11000,
        likes: 1400,
        comments: 40,
        shares: 120,
        caption: "These are the comic books kids actually love! \"Raise children Street-Smart\" helps them solve life problems with strategy, boost EQ, and broaden their horizons. #StreetSmart #FamilyEducation",
        productRefs: []
      }) + "\n"
    );
    await writeFile(path.join(dataDir, "signals", "signals.jsonl"), "");

    const records = await buildBaseDashboardRecords({ dataDir });

    assert.equal(records.videos.length, 1);
    assert.equal(records.videos[0].fields["商品主题"], "raise children street smart");
    assert.equal(records.accounts[0].fields["近期主打主题"], "raise children street smart");
    assert.equal(records.themes[0].fields["主题"], "raise children street smart");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildBaseDashboardRecords can build whitelist tracking account and video pools with 发布时间、更新时间、上次值和增量字段", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-whitelist-records-"));
  try {
    const videoUrl = "https://www.tiktok.com/@alpha/video/7623225588626590990";
    const postedAt = "2026-05-25T08:00:00.000Z";
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "signals"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        JSON.stringify({
          collectedAt: "2026-05-26T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl,
          postedAt,
          views: 1000,
          likes: 100,
          comments: 10,
          shares: 5
        }),
        JSON.stringify({
          collectedAt: "2026-05-26T12:00:00.000Z",
          accountHandle: "alpha",
          videoUrl,
          postedAt,
          views: 1700,
          likes: 160,
          comments: 15,
          shares: 8
        })
      ].join("\n") + "\n"
    );
    await writeFile(
      path.join(dataDir, "signals", "signals.jsonl"),
      JSON.stringify({
        entityType: "video",
        entityUrl: videoUrl,
        accountHandle: "alpha",
        signalKind: "sustained_growth",
        signalLabel: "增量异常",
        operatorAction: "优先检查这一条的起量原因。",
        current: { videoUrl, postedAt },
        deltas: { views: 700, likes: 60, comments: 5, shares: 3 },
        detectedAt: "2026-05-26T12:00:00.000Z"
      }) + "\n"
    );

    const records = await buildBaseDashboardRecords({
      dataDir,
      whitelistAccounts: [
        {
          id: "wl-alpha",
          handle: "alpha",
          accountName: "alpha",
          profileUrl: "https://www.tiktok.com/@alpha",
          sourceTables: ["People Skills"],
          materialTypes: ["AI动画"],
          remark: "",
          skipTracking: false
        }
      ]
    });

    assert.equal(records.accounts.length, 1);
    assert.equal(records.videos.length, 1);
    assert.equal(records.accounts[0].fields["账号名"], "alpha");
    assert.equal(records.accounts[0].fields["来源表"], "People Skills");
    assert.equal(records.accounts[0].fields["追踪状态"], "追踪中");
    assert.equal(records.accounts[0].fields["近90天视频数"], 1);
    assert.ok(records.accounts[0].fields["最近更新时间"]);
    assert.ok(records.accounts[0].fields["最近发布时间"]);
    assert.equal(records.accounts[0].key, "wl-alpha");
    assert.equal(records.videos[0].key, `wl-alpha::${videoUrl}`);
    assert.deepEqual(records.videos[0].links["所属账号"], [{ kind: "accounts", rowKey: "wl-alpha" }]);
    assert.ok(records.videos[0].fields["发布时间"]);
    assert.equal(records.videos[0].fields["来源表"], "People Skills");
    assert.equal(records.videos[0].fields["素材类型"], "AI动画");
    assert.equal(records.videos[0].fields["当前播放"], 1700);
    assert.equal(records.videos[0].fields["当前点赞"], 160);
    assert.equal(records.videos[0].fields["当前评论"], 15);
    assert.equal(records.videos[0].fields["当前转发"], 8);
    assert.equal(records.videos[0].fields["上次播放"], 1000);
    assert.equal(records.videos[0].fields["上次点赞"], 100);
    assert.equal(records.videos[0].fields["上次评论"], 10);
    assert.equal(records.videos[0].fields["上次转发"], 5);
    assert.equal(records.videos[0].fields["播放增量"], 700);
    assert.equal(records.videos[0].fields["点赞增量"], 60);
    assert.equal(records.videos[0].fields["评论增量"], 5);
    assert.equal(records.videos[0].fields["转发增量"], 3);
    assert.ok(records.videos[0].fields["更新时间"]);
    assert.ok(records.videos[0].fields["上次更新时间"]);
    assert.equal(records.videos[0].fields["异常增长标签"], "增量异常");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("buildBaseDashboardRecords stays empty in whitelist mode when whitelist rows are unavailable", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-whitelist-empty-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify(
        [{ handle: "legacy_alpha", profileUrl: "https://www.tiktok.com/@legacy_alpha", enabled: true }],
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "base_dashboard_whitelist_config.json"),
      JSON.stringify(
        {
          baseToken: "app_test",
          tableNames: {
            accounts: "白名单追踪账号池",
            videos: "白名单追踪视频池",
            themes: "白名单主题参考库"
          }
        },
        null,
        2
      )
    );

    const records = await buildBaseDashboardRecords({ dataDir });

    assert.equal(records.accounts.length, 0);
    assert.equal(records.videos.length, 0);
    assert.equal(records.themes.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("syncFeishuBaseSchema refreshes field ids before setting visible fields after creating new fields", async () => {
  const visibleFieldPayloads = [];
  let accountFieldListCalls = 0;
  const createdViews = new Map();

  await syncFeishuBaseSchema({
    baseToken: "app_test",
    tableMap: { accounts: "tbl_accounts", videos: "tbl_videos", themes: "tbl_themes" },
    dryRun: false,
    platform: "linux",
    larkCliPath: "lark-cli",
    async execFileImpl(command, args) {
      if (args[1] === "+table-update") {
        return { stdout: JSON.stringify({ ok: true }) };
      }
      if (args[1] === "+field-list") {
        if (args.includes("tbl_accounts")) {
          accountFieldListCalls += 1;
          if (accountFieldListCalls === 1) {
            return {
              stdout: JSON.stringify({
                data: {
                  fields: [
                    { id: "fld_rank", name: "账号排名" },
                    { id: "fld_account", name: "账号" },
                    { id: "fld_priority", name: "重点等级" },
                    { id: "fld_posts7d", name: "近7天发文数" },
                    { id: "fld_strong7d", name: "近7天好素材数" },
                    { id: "fld_signal", name: "最近爆点标签" },
                    { id: "fld_latest_burst", name: "最近一次起量时间" },
                    { id: "fld_topviews", name: "近15天最高播放" },
                    { id: "fld_heat", name: "账号热度分" },
                    { id: "fld_latest_post", name: "最近发文时间" }
                  ]
                }
              })
            };
          }
          return {
            stdout: JSON.stringify({
              data: {
                fields: [
                  { id: "fld_rank", name: "账号排名" },
                  { id: "fld_account", name: "账号" },
                  { id: "fld_priority", name: "重点等级" },
                  { id: "fld_theme", name: "近期主打主题" },
                  { id: "fld_posts7d", name: "近7天发文数" },
                  { id: "fld_strong7d", name: "近7天好素材数" },
                  { id: "fld_signal", name: "最近爆点标签" },
                  { id: "fld_latest_burst", name: "最近一次起量时间" },
                  { id: "fld_topviews", name: "近15天最高播放" },
                  { id: "fld_latest_hot_video", name: "最新爆点视频" },
                  { id: "fld_heat", name: "账号热度分" },
                  { id: "fld_latest_post", name: "最近发文时间" }
                ]
              }
            })
          };
        }
        if (args.includes("tbl_videos")) {
          return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_video", name: "视频链接" }, { id: "fld_account_link", name: "所属账号" }] } }) };
        }
        return { stdout: JSON.stringify({ data: { fields: [{ id: "fld_theme_name", name: "主题" }] } }) };
      }
      if (args[1] === "+field-create") {
        return { stdout: JSON.stringify({ ok: true }) };
      }
      if (args[1] === "+view-list") {
        if (args.includes("tbl_accounts")) {
          return { stdout: JSON.stringify({ data: { views: [{ id: "viw_accounts", name: "账号榜" }] } }) };
        }
        const tableId = args[args.indexOf("--table-id") + 1];
        return { stdout: JSON.stringify({ data: { views: createdViews.get(tableId) ?? [] } }) };
      }
      if (args[1] === "+view-create") {
        const tableId = args[args.indexOf("--table-id") + 1];
        const payload = JSON.parse(args[args.indexOf("--json") + 1]);
        const nextViews = [...(createdViews.get(tableId) ?? []), { id: `viw_${tableId}_${payload.name}`, name: payload.name }];
        createdViews.set(tableId, nextViews);
        return { stdout: JSON.stringify({ ok: true }) };
      }
      if (args[1] === "+view-set-visible-fields" && args.includes("tbl_accounts")) {
        visibleFieldPayloads.push(JSON.parse(args[args.indexOf("--json") + 1]));
      }
      return { stdout: JSON.stringify({ ok: true }) };
    }
  });

  assert.equal(accountFieldListCalls >= 2, true);
  assert.deepEqual(visibleFieldPayloads.at(-1)?.visible_fields, [
    "fld_rank",
    "fld_account",
    "fld_latest_hot_video",
    "fld_theme",
    "fld_signal",
    "fld_strong7d",
    "fld_topviews",
    "fld_priority"
  ]);
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
        "accounts:tbl_accounts:book_alpha": {
          recordId: "rec_account_1",
          kind: "accounts",
          tableId: "tbl_accounts",
          rowKey: "book_alpha"
        },
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
        videos: [{
          fields: { "视频链接": "https://www.tiktok.com/@book/video/1" },
          key: "video-1",
          links: { "所属账号": [{ kind: "accounts", rowKey: "book_alpha" }] }
        }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos",
        themes: "tbl_themes"
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
    assert.equal(accountArgs.includes("--record-id"), true);
    assert.equal(accountArgs[accountArgs.indexOf("--record-id") + 1], "rec_account_1");
    assert.equal(videoArgs.includes("--record-id"), true);
    assert.equal(videoArgs[videoArgs.indexOf("--record-id") + 1], "rec_video_1");
    const videoPayload = JSON.parse(videoArgs[videoArgs.indexOf("--json") + 1]);
    assert.deepEqual(videoPayload["所属账号"], [{ id: "rec_account" }]);

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
        accounts: "tbl_accounts",
        videos: "tbl_videos",
        themes: "tbl_themes"
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
        videos: "tbl_videos",
        themes: "tbl_themes"
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

test("refreshFeishuBaseRecordMap deletes stale and duplicate dashboard rows", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-record-prune-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  const invocations = [];
  try {
    await writeFile(recordMapPath, JSON.stringify({
      "videos:tbl_videos:https://www.tiktok.com/@book_alpha/video/7623225588626590990": {
        recordId: "rec_keep_old",
        kind: "videos",
        tableId: "tbl_videos",
        rowKey: "https://www.tiktok.com/@book_alpha/video/7623225588626590990"
      },
      "videos:tbl_videos:https://www.tiktok.com/@book_alpha/video/7999999999999999999": {
        recordId: "rec_stale",
        kind: "videos",
        tableId: "tbl_videos",
        rowKey: "https://www.tiktok.com/@book_alpha/video/7999999999999999999"
      }
    }));

    const result = await refreshFeishuBaseRecordMap({
      dataDir,
      recordMapPath,
      records: {
        accounts: [],
        videos: [
          {
            key: "https://www.tiktok.com/@book_alpha/video/7623225588626590990",
            fields: { "视频链接": "https://www.tiktok.com/@book_alpha/video/7623225588626590990" }
          }
        ]
      },
      baseToken: "app_test",
      tableMap: { accounts: "tbl_accounts", videos: "tbl_videos", themes: "tbl_themes" },
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        invocations.push({ command, args });
        if (args[1] === "+record-list") {
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["视频链接"],
                data: [
                  ["https://www.tiktok.com/@book_alpha/video/7623225588626590990"],
                  ["https://www.tiktok.com/@book_alpha/video/7623225588626590990"],
                  ["https://www.tiktok.com/@book_alpha/video/7999999999999999999"]
                ],
                record_id_list: ["rec_keep", "rec_dup", "rec_stale_remote"]
              }
            })
          };
        }
        return { stdout: JSON.stringify({ ok: true }) };
      }
    });

    assert.equal(result.mappedRecordCount, 1);
    const deleteIds = invocations
      .filter((item) => item.args[1] === "+record-delete")
      .map((item) => item.args[item.args.indexOf("--record-id") + 1])
      .sort();
    assert.deepEqual(deleteIds, ["rec_dup", "rec_stale", "rec_stale_remote"].sort());
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("refreshFeishuBaseRecordMap paginates record-list output to rebuild full row cache", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-refresh-pages-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  try {
    const videoRows = Array.from({ length: 205 }, (_, index) => ({
      fields: { "视频链接": `https://www.tiktok.com/@book/video/${index + 1}` },
      key: `https://www.tiktok.com/@book/video/${index + 1}`
    }));
    const seenOffsets = [];
    const result = await refreshFeishuBaseRecordMap({
      dataDir,
      recordMapPath,
      records: {
        accounts: [],
        videos: videoRows
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos",
        themes: "tbl_themes"
      },
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        if (args[1] !== "+record-list") {
          return { stdout: JSON.stringify({ ok: true }) };
        }
        const offsetIndex = args.indexOf("--offset");
        const offset = offsetIndex >= 0 ? Number(args[offsetIndex + 1]) : 0;
        seenOffsets.push(offset);
        const start = offset + 1;
        const end = Math.min(offset + 200, 205);
        const values = [];
        const recordIds = [];
        for (let value = start; value <= end; value += 1) {
          values.push([`[https://www.tiktok.com/@book/video/${value}](https://www.tiktok.com/@book/video/${value})`]);
          recordIds.push(`rec_video_${value}`);
        }
        return {
          stdout: JSON.stringify({
            data: {
              fields: ["视频链接"],
              data: values,
              record_id_list: recordIds
            }
          })
        };
      }
    });

    assert.deepEqual(seenOffsets, [0, 200]);
    assert.equal(result.mappedRecordCount, 205);
    const map = JSON.parse(await readFile(recordMapPath, "utf8"));
    assert.equal(map["videos:tbl_videos:https://www.tiktok.com/@book/video/1"].recordId, "rec_video_1");
    assert.equal(map["videos:tbl_videos:https://www.tiktok.com/@book/video/205"].recordId, "rec_video_205");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("refreshFeishuBaseRecordMap prunes stale cached keys for processed tables", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-base-refresh-prune-"));
  const recordMapPath = path.join(dataDir, "base_record_map.json");
  try {
    await writeFile(
      recordMapPath,
      JSON.stringify({
        "videos:tbl_videos:https://www.tiktok.com/@book/video/1": {
          recordId: "rec_old_keep",
          kind: "videos",
          tableId: "tbl_videos",
          rowKey: "https://www.tiktok.com/@book/video/1"
        },
        "videos:tbl_videos:https://www.tiktok.com/@book/video/old": {
          recordId: "rec_old_drop",
          kind: "videos",
          tableId: "tbl_videos",
          rowKey: "https://www.tiktok.com/@book/video/old"
        }
      })
    );

    await refreshFeishuBaseRecordMap({
      dataDir,
      recordMapPath,
      records: {
        accounts: [],
        videos: [{ fields: { "视频链接": "https://www.tiktok.com/@book/video/1" }, key: "https://www.tiktok.com/@book/video/1" }]
      },
      baseToken: "app_test",
      tableMap: {
        accounts: "tbl_accounts",
        videos: "tbl_videos",
        themes: "tbl_themes"
      },
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl() {
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

    const map = JSON.parse(await readFile(recordMapPath, "utf8"));
    assert.equal(map["videos:tbl_videos:https://www.tiktok.com/@book/video/1"].recordId, "rec_video");
    assert.equal(Object.hasOwn(map, "videos:tbl_videos:https://www.tiktok.com/@book/video/old"), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
