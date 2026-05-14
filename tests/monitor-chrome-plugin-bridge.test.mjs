import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { collectChromeSnapshots } from "../src/monitor/chrome-source.mjs";
import {
  createChromePluginBrowserClient,
  parseCompactNumber,
  parseTikTokProfileVideos,
  parseTikTokShopProducts,
  parseTikTokVideoDetail
} from "../src/monitor/chrome-plugin-bridge.mjs";
import { runMonitorOnce } from "../src/monitor/runner.mjs";

test("parseCompactNumber supports K/M/B and Chinese unit suffixes", () => {
  assert.equal(parseCompactNumber("1.2K"), 1200);
  assert.equal(parseCompactNumber("3M"), 3000000);
  assert.equal(parseCompactNumber("4.5B"), 4500000000);
  assert.equal(parseCompactNumber("1.3万"), 13000);
  assert.equal(parseCompactNumber("2亿"), 200000000);
  assert.equal(parseCompactNumber("12,345"), 12345);
});

test("parseTikTokProfileVideos extracts and dedupes public video links", () => {
  const snapshot = `
    <a href="https://www.tiktok.com/@book_alpha/video/735111">first</a>
    <a href="/@book_alpha/video/735222">second</a>
    <a href="https://www.tiktok.com/@book_alpha/video/735111">duplicate</a>
  `;

  const videos = parseTikTokProfileVideos(snapshot, {
    baseUrl: "https://www.tiktok.com/@book_alpha",
    maxVideos: 6
  });

  assert.deepEqual(videos.map((video) => video.videoUrl), [
    "https://www.tiktok.com/@book_alpha/video/735111",
    "https://www.tiktok.com/@book_alpha/video/735222"
  ]);
});

test("parseTikTokProfileVideos keeps grid view counts and honors high coverage limits", () => {
  const snapshot = Array.from({ length: 8 }, (_, index) => {
    const id = 735000 + index;
    return `<a href="/@book_alpha/video/${id}">video ${index}</a><strong>${index + 1}.5K views</strong>`;
  }).join("\n");

  const videos = parseTikTokProfileVideos(snapshot, {
    baseUrl: "https://www.tiktok.com/@book_alpha",
    maxVideos: 60
  });

  assert.equal(videos.length, 8);
  assert.equal(videos[0].videoUrl, "https://www.tiktok.com/@book_alpha/video/735000");
  assert.equal(videos[0].views, 1500);
  assert.equal(videos[7].views, 8500);
});

test("parseTikTokProfileVideos can read itemList from hydration JSON", () => {
  const snapshot = `
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.user-detail": {
          userInfo: {
            itemList: [
              {
                id: "7615603816745979166",
                author: { uniqueId: "book_alpha" },
                stats: { playCount: 3800000 }
              },
              {
                itemStruct: {
                  id: "7615603816745979999",
                  author: { uniqueId: "book_alpha" },
                  statsV2: { playCount: "24730" }
                }
              }
            ]
          }
        }
      }
    })}</script>
  `;

  const videos = parseTikTokProfileVideos(snapshot, {
    baseUrl: "https://www.tiktok.com/@book_alpha",
    maxVideos: 6
  });

  assert.deepEqual(videos, [
    {
      videoUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979166",
      views: 3800000
    },
    {
      videoUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979999",
      views: 24730
    }
  ]);
});

test("parseTikTokVideoDetail extracts public metrics and classifies blocked pages", () => {
  const ok = parseTikTokVideoDetail(
    `
    Caption: This book changed how I think about money.
    12.4K views
    1.2K likes
    88 comments
    35 shares
    `,
    {
      videoUrl: "https://www.tiktok.com/@book_alpha/video/735111",
      accountHandle: "book_alpha"
    }
  );

  assert.equal(ok.status, "ok");
  assert.equal(ok.video.views, 12400);
  assert.equal(ok.video.likes, 1200);
  assert.equal(ok.video.comments, 88);
  assert.equal(ok.video.shares, 35);
  assert.match(ok.video.caption, /book changed/);

  assert.equal(parseTikTokVideoDetail("Log in to TikTok to continue", {}).status, "login_required");
  assert.equal(parseTikTokVideoDetail("Complete captcha verification", {}).status, "blocked");
  assert.equal(parseTikTokVideoDetail("This video is not available in your region", {}).status, "blocked");
  assert.equal(parseTikTokVideoDetail("A normal page without public metrics", {}).status, "missing_metrics");
});

test("parseTikTokVideoDetail prefers hydration JSON when TikTok embeds structured stats", () => {
  const snapshot = `
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          itemInfo: {
            itemStruct: {
              id: "7596015204631055646",
              desc: "Stop Teaching Kids to Be Good. Teach Them How the World Works.",
              createTime: 1737117744,
              author: { uniqueId: "guidance811" },
              stats: {
                diggCount: 175600,
                shareCount: 46200,
                commentCount: 1657,
                playCount: 3800000
              }
            }
          }
        }
      }
    })}</script>
    <div>评论 点赞 分享</div>
  `;

  const parsed = parseTikTokVideoDetail(snapshot, {
    videoUrl: "https://www.tiktok.com/@guidance811/video/7596015204631055646"
  });

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.accountHandle, "guidance811");
  assert.equal(parsed.video.videoUrl, "https://www.tiktok.com/@guidance811/video/7596015204631055646");
  assert.equal(parsed.video.views, 3800000);
  assert.equal(parsed.video.likes, 175600);
  assert.equal(parsed.video.comments, 1657);
  assert.equal(parsed.video.shares, 46200);
  assert.match(parsed.video.caption, /Teach Them How the World Works/);
  assert.equal(parsed.video.postedAt, "2025-01-17T12:42:24.000Z");
});

test("parseTikTokVideoDetail accepts zeroed hydration stats as valid detail", () => {
  const snapshot = `
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          itemInfo: {
            itemStruct: {
              id: "7632538097196027150",
              author: { uniqueId: "_realnosa" },
              statsV2: {
                diggCount: "0",
                shareCount: "194",
                commentCount: "0",
                playCount: "0"
              }
            }
          }
        }
      }
    })}</script>
  `;

  const parsed = parseTikTokVideoDetail(snapshot, {
    videoUrl: "https://www.tiktok.com/@_realnosa/video/7632538097196027150"
  });

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.views, 0);
  assert.equal(parsed.video.likes, 0);
  assert.equal(parsed.video.comments, 0);
  assert.equal(parsed.video.shares, 194);
});

test("parseTikTokVideoDetail does not treat ARIA region as blocked and parses Chinese metrics", () => {
  const parsed = parseTikTokVideoDetail(
    `
    - region "Notifications alt+T"
    - button "点赞视频 28.6K 个赞": - strong: 28.6K
    - button "阅读或添加评论 181 条评论": - strong: "181"
    - button "分享视频 4800 次分享": - strong: "4800"
    `,
    {
      videoUrl: "https://www.tiktok.com/@book_alpha/video/735111",
      accountHandle: "book_alpha"
    }
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.views, 0);
  assert.equal(parsed.video.likes, 28600);
  assert.equal(parsed.video.comments, 181);
  assert.equal(parsed.video.shares, 4800);
});

test("parseTikTokVideoDetail prefers populated TikTok metrics over earlier zero-value noise", () => {
  const parsed = parseTikTokVideoDetail(
    `
    - generic: 0 likes
    - generic: 0 comments
    - button "点赞视频 28.6K 个赞": - strong: 28.6K
    - button "阅读或添加评论 181 条评论": - strong: "181"
    - button "分享视频 4800 次分享": - strong: "4800"
    - button "点赞视频 8 个赞": - strong: "8"
    - button "阅读或添加评论 0 条评论": - strong: "0"
    `,
    {
      videoUrl: "https://www.tiktok.com/@book_alpha/video/735111",
      accountHandle: "book_alpha"
    }
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.likes, 28600);
  assert.equal(parsed.video.comments, 181);
  assert.equal(parsed.video.shares, 4800);
});

test("parseTikTokVideoDetail resolves short links to canonical video URL and account handle", () => {
  const parsed = parseTikTokVideoDetail(
    `
    - link "creator": - /url: /@book_alpha
    - link "video": - /url: /@book_alpha/video/7615603816745979166
    - button "点赞视频 28.6K 个赞": - strong: 28.6K
    - button "阅读或添加评论 181 条评论": - strong: "181"
    - button "分享视频 4800 次分享": - strong: "4800"
    `,
    {
      videoUrl: "https://www.tiktok.com/t/ZTk792FfQ"
    }
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.accountHandle, "book_alpha");
  assert.equal(parsed.video.videoUrl, "https://www.tiktok.com/@book_alpha/video/7615603816745979166");
});

test("parseTikTokVideoDetail can resolve identity from redirected tab URL", () => {
  const parsed = parseTikTokVideoDetail(
    `
    - button "点赞视频 28.6K 个赞": - strong: 28.6K
    - button "阅读或添加评论 181 条评论": - strong: "181"
    - button "分享视频 4800 次分享": - strong: "4800"
    `,
    {
      videoUrl: "https://www.tiktok.com/t/ZTk792FfQ",
      currentUrl: "https://www.tiktok.com/@book_alpha/video/7615603816745979166?lang=en"
    }
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.video.accountHandle, "book_alpha");
  assert.equal(parsed.video.videoUrl, "https://www.tiktok.com/@book_alpha/video/7615603816745979166");
});

test("parseTikTokShopProducts returns missing_metrics when public shop data is hidden", () => {
  const hidden = parseTikTokShopProducts("Welcome to TikTok Shop", {
    shopUrl: "https://www.tiktok.com/shop/alpha",
    maxProducts: 6
  });

  assert.equal(hidden.status, "missing_metrics");

  const visible = parseTikTokShopProducts(
    `
    <a href="/shop/p/alpha-book">Money Habits Book</a>
    $18.99
    1.5K sold
    123 reviews
    rating 4.8
    `,
    {
      shopUrl: "https://www.tiktok.com/shop/alpha",
      maxProducts: 6
    }
  );

  assert.equal(visible.status, "ok");
  assert.equal(visible.products[0].productUrl, "https://www.tiktok.com/shop/p/alpha-book");
  assert.equal(visible.products[0].soldCount, 1500);
});

test("Chrome plugin bridge reuses at most two owned tabs and never closes preexisting tabs", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/@book_alpha",
        `
        <a href="/@book_alpha/video/735111">one</a>
        <a href="/@book_alpha/video/735222">two</a>
        `
      ],
      [
        "https://www.tiktok.com/@book_alpha/video/735111",
        "Caption: First public book video\n12.4K views\n1.2K likes\n88 comments\n35 shares"
      ],
      [
        "https://www.tiktok.com/@book_alpha/video/735222",
        "Caption: Second public book video\n4.1K views\n510 likes\n20 comments\n9 shares"
      ],
      [
        "https://www.tiktok.com/shop/alpha",
        `<a href="/shop/p/alpha-book">Money Habits Book</a>\n$18.99\n1.5K sold\n123 reviews\nrating 4.8`
      ]
    ])
  });
  const browserClient = createChromePluginBrowserClient({
    browser: fakeBrowser,
    maxVideosPerAccount: 6,
    maxProductsPerShop: 6
  });

  const result = await collectChromeSnapshots({
    browserClient,
    maxTabs: 2,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [
      {
        id: "account-alpha",
        handle: "book_alpha",
        profileUrl: "https://www.tiktok.com/@book_alpha",
        enabled: true
      }
    ],
    shops: [
      {
        id: "shop-alpha",
        name: "Alpha Books",
        shopUrl: "https://www.tiktok.com/shop/alpha",
        enabled: true
      }
    ]
  });

  assert.equal(result.videoSnapshots.length, 2);
  assert.equal(result.productSnapshots.length, 1);
  assert.equal(fakeBrowser.maxOpenOwnedTabs, 2);
  assert.equal(fakeBrowser.openOwnedTabs.size, 0);
  assert.ok(!fakeBrowser.closedTabs.includes("preexisting-user-tab"));
});

test("collectChromeSnapshots can collect direct video seed URLs", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        "Caption: Short link public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    browserClient: createChromePluginBrowserClient({ browser: fakeBrowser }),
    maxTabs: 2,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [],
    shops: [],
    videos: [
      {
        id: "video-short",
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        enabled: true
      }
    ]
  });

  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].videoUrl, "https://www.tiktok.com/t/ZTk7Hm8ro");
  assert.equal(result.videoSnapshots[0].views, 9500);
  assert.equal(fakeBrowser.maxOpenOwnedTabs, 1);
});

test("Chrome plugin bridge waits for delayed public video metrics", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        [
          "TikTok page shell without metrics yet",
          "TikTok page shell without metrics yet",
          "Caption: Delayed public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
        ]
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    browserClient: createChromePluginBrowserClient({
      browser: fakeBrowser,
      snapshotRetryDelayMs: 1
    }),
    maxTabs: 2,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [],
    shops: [],
    videos: [
      {
        id: "video-short",
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        enabled: true
      }
    ]
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].views, 9500);
});

test("Chrome plugin bridge fails fast when a DOM snapshot hangs", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        () => new Promise(() => {})
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    browserClient: createChromePluginBrowserClient({
      browser: fakeBrowser,
      snapshotRetries: 0,
      snapshotTimeoutMs: 5
    }),
    maxTabs: 1,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [],
    shops: [],
    videos: [
      {
        id: "video-hung",
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        enabled: true
      }
    ]
  });

  assert.equal(result.videoSnapshots.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].status, "failed");
  assert.match(result.failures[0].reason, /chrome_operation_timeout: domSnapshot exceeded 5ms/);
  assert.equal(fakeBrowser.openOwnedTabs.size, 0);
});

test("Chrome plugin bridge applies navigation timeout settings", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        "Caption: Public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
      ]
    ])
  });

  await collectChromeSnapshots({
    browserClient: createChromePluginBrowserClient({
      browser: fakeBrowser,
      waitUntil: "load",
      timeoutMs: 4321
    }),
    maxTabs: 1,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [],
    shops: [],
    videos: [
      {
        id: "video-short",
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        enabled: true
      }
    ]
  });

  assert.deepEqual(fakeBrowser.waitForLoadStateCalls, [
    { state: "load", timeoutMs: 4321 }
  ]);
});

test("Chrome plugin bridge keeps waiting when only share metrics have rendered", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        [
          "button \"分享视频 4800 次分享\": - strong: \"4800\"",
          `
          button "点赞视频 28.6K 个赞": - strong: 28.6K
          button "阅读或添加评论 181 条评论": - strong: "181"
          button "分享视频 4800 次分享": - strong: "4800"
          `
        ]
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    browserClient: createChromePluginBrowserClient({
      browser: fakeBrowser,
      snapshotRetryDelayMs: 1
    }),
    maxTabs: 2,
    now: new Date("2026-05-09T12:00:00.000Z"),
    accounts: [],
    shops: [],
    videos: [
      {
        id: "video-short",
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        enabled: true
      }
    ]
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots[0].likes, 28600);
  assert.equal(result.videoSnapshots[0].comments, 181);
  assert.equal(result.videoSnapshots[0].shares, 4800);
});

test("Chrome plugin bridge waits for delayed search results before parsing candidates", async () => {
  const fakeBrowser = createFakeChromePluginBrowser({
    snapshotsByUrl: new Map([
      [
        "https://www.tiktok.com/search?q=people%20skill",
        [
          "- main:\n  - complementary\n  - button:",
          `<a href="/@book_seller/video/735111">people skill book review</a><a href="/shop/book-seller">Visit shop</a>`
        ]
      ]
    ])
  });
  const browserClient = createChromePluginBrowserClient({
    browser: fakeBrowser,
    snapshotRetryDelayMs: 1
  });
  const tab = await fakeBrowser.tabs.new();
  await browserClient.navigate(tab, "https://www.tiktok.com/search?q=people%20skill");

  const parsed = await browserClient.extractSearchResults({ listTab: tab, query: "people skill" });

  assert.equal(parsed.accounts.length, 1);
  assert.equal(parsed.shops.length, 1);
  assert.equal(parsed.accounts[0].handle, "book_seller");
});

test("runMonitorOnce can use the Chrome plugin bridge end to end with dry-run alerts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-chrome-plugin-runner-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          lastKnownPostAt: "2026-05-09T01:00:00.000Z",
          enabled: true
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "shops.json"),
      JSON.stringify([
        {
          id: "shop-alpha",
          name: "Alpha Books",
          shopUrl: "https://www.tiktok.com/shop/alpha",
          enabled: true
        }
      ])
    );
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T06:00:00.000Z",
        source: "chrome",
        accountHandle: "book_alpha",
        videoUrl: "https://www.tiktok.com/@book_alpha/video/735111",
        caption: "Public book video",
        postedAt: "2026-05-09T05:00:00.000Z",
        views: 1000,
        likes: 20,
        comments: 1,
        shares: 1,
        productRefs: []
      }) + "\n"
    );
    await writeFile(
      path.join(dataDir, "snapshots", "shop_product_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T06:00:00.000Z",
        source: "chrome",
        shopName: "Alpha Books",
        productUrl: "https://www.tiktok.com/shop/p/alpha-book",
        title: "Money Habits Book",
        price: 19.99,
        soldCount: 100,
        reviewCount: 10,
        rating: 4.5
      }) + "\n"
    );

    const fakeBrowser = createFakeChromePluginBrowser({
      snapshotsByUrl: new Map([
        ["https://www.tiktok.com/@book_alpha", `<a href="/@book_alpha/video/735111">one</a>`],
        [
          "https://www.tiktok.com/@book_alpha/video/735111",
          "Caption: Public book video\n12.4K views\n1.2K likes\n88 comments\n35 shares"
        ],
        ["https://www.tiktok.com/shop/alpha", `<a href="/shop/p/alpha-book">Money Habits Book</a>\n1.5K sold`]
      ])
    });

    const sentAlerts = [];
    const result = await runMonitorOnce({
      dataDir,
      source: "chrome",
      targets: ["accounts", "shops"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      browserClient: createChromePluginBrowserClient({ browser: fakeBrowser }),
      alertMode: "dm",
      alertRecipient: "ou_test_user",
      notifier: {
        async send(alert) {
          sentAlerts.push(alert);
          return { status: "sent", messageId: "dry-run" };
        }
      },
      config: {
        maxTabs: 2,
        min6hViews: 3000,
        min24hViews: 10000,
        staleAccountDays: 60
      }
    });

    assert.equal(result.source, "chrome");
    assert.ok(result.snapshots.video > 0);
    assert.ok(sentAlerts.length > 0);

    const videoLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.match(videoLog, /book_alpha/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createFakeChromePluginBrowser({ snapshotsByUrl }) {
  let created = 0;
  const browser = {
    openOwnedTabs: new Set(),
    closedTabs: [],
    waitForLoadStateCalls: [],
    maxOpenOwnedTabs: 0,
    preexistingTabs: new Set(["preexisting-user-tab"]),
    tabs: {
      async new() {
        created += 1;
        const tab = createFakePluginTab(`owned-${created}`, snapshotsByUrl, browser);
        browser.openOwnedTabs.add(tab.id);
        browser.maxOpenOwnedTabs = Math.max(browser.maxOpenOwnedTabs, browser.openOwnedTabs.size);
        return tab;
      }
    }
  };
  return browser;
}

function createFakePluginTab(id, snapshotsByUrl, browser) {
  const snapshotReadsByUrl = new Map();
  const tab = {
    id,
    currentUrl: "about:blank",
    async goto(url) {
      tab.currentUrl = url;
    },
    async close() {
      tab.closed = true;
      browser.closedTabs.push(tab.id);
      browser.openOwnedTabs.delete(tab.id);
    },
    playwright: {
      async waitForLoadState(options) {
        browser.waitForLoadStateCalls.push(options);
      },
      async domSnapshot() {
        const snapshot = snapshotsByUrl.get(tab.currentUrl);
        if (typeof snapshot === "function") return snapshot();
        if (Array.isArray(snapshot)) {
          const reads = snapshotReadsByUrl.get(tab.currentUrl) ?? 0;
          snapshotReadsByUrl.set(tab.currentUrl, reads + 1);
          return snapshot[Math.min(reads, snapshot.length - 1)] ?? "";
        }
        return snapshot ?? "";
      }
    }
  };
  return tab;
}
