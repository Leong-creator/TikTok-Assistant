import assert from "node:assert/strict";
import test from "node:test";

import { createPlaywrightBrowserClient } from "../src/monitor/playwright-browser-client.mjs";

test("playwright browser client exposes the collector contract", () => {
  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {},
      pages() {
        return [];
      }
    }
  });

  assert.equal(typeof client.createTab, "function");
  assert.equal(typeof client.closeTab, "function");
  assert.equal(typeof client.navigate, "function");
  assert.equal(typeof client.extractAccountVideos, "function");
  assert.equal(typeof client.extractDirectVideo, "function");
  assert.equal(typeof client.extractSearchResults, "function");
  assert.equal(typeof client.extractProfileShopRefs, "function");
  assert.equal(typeof client.extractProfileVideos, "function");
  assert.equal(typeof client.extractShopProducts, "function");
  assert.equal(client.usesDetailTab, true);
});

test("playwright browser client wraps pages, waits for load state, and reuses existing parsers", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        [
          "shell without metrics",
          "Caption: Public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
        ]
      ],
      [
        "https://www.tiktok.com/@book_seller/video/735111",
        "Caption: Public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
      ],
      [
        "https://www.tiktok.com/search?q=people%20skill",
        `<a href="/@book_seller/video/735111">people skill book review</a><a href="/shop/book-seller">Visit shop</a>`
      ],
      [
        "https://www.tiktok.com/@book_seller",
        `<a href="/@book_seller/video/735111">clip</a><a href="/shop/book-seller">Visit shop</a>`
      ],
      [
        "https://www.tiktok.com/shop/book-seller",
        `<a href="/shop/p/people-skills-book">People Skills</a>\n$18.99\n1.5K sold\n123 reviews\nrating 4.8`
      ]
    ])
  });
  const context = {
    async newPage() {
      return page;
    },
    pages() {
      return [page];
    }
  };

  const client = createPlaywrightBrowserClient({
    context,
    timeoutMs: 4321,
    snapshotRetries: 1,
    snapshotRetryDelayMs: 1
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/t/ZTk7Hm8ro");
  const video = await client.extractDirectVideo({
    detailTab: tab,
    video: {
      videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
      accountHandle: "book_seller"
    }
  });

  await client.navigate(tab, "https://www.tiktok.com/search?q=people%20skill");
  const search = await client.extractSearchResults({ listTab: tab, query: "people skill" });

  await client.navigate(tab, "https://www.tiktok.com/@book_seller");
  const refs = await client.extractProfileShopRefs({
    profileTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller",
      relatedBooks: ["people_skills"]
    }
  });
  const videos = await client.extractProfileVideos({
    profileTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    }
  });
  await client.navigate(tab, "https://www.tiktok.com/@book_seller");
  const accountVideos = await client.extractAccountVideos({
    listTab: tab,
    detailTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    }
  });

  await client.navigate(tab, "https://www.tiktok.com/shop/book-seller");
  const products = await client.extractShopProducts({
    listTab: tab,
    shop: {
      shopUrl: "https://www.tiktok.com/shop/book-seller",
      name: "Book Seller"
    }
  });

  assert.equal(video.status, "ok");
  assert.equal(video.video.views, 9500);
  assert.equal(accountVideos.status, "ok");
  assert.equal(accountVideos.videos[0].videoUrl, "https://www.tiktok.com/@book_seller/video/735111");
  assert.equal(search.accounts[0].handle, "book_seller");
  assert.equal(search.shops[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
  assert.equal(refs[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
  assert.equal(videos.status, "ok");
  assert.equal(videos.videoLinks[0].videoUrl, "https://www.tiktok.com/@book_seller/video/735111");
  assert.equal(products.status, "ok");
  assert.equal(products.products[0].productUrl, "https://www.tiktok.com/shop/p/people-skills-book");
  assert.equal(page.waitForLoadStateCalls.length, 12);
  assert.deepEqual(
    page.waitForLoadStateCalls.every((call, index) =>
      call.state === "domcontentloaded" && call.timeout === (index % 2 === 0 ? 15000 : 4321)
    ),
    true
  );

  await client.closeTab(tab);
  assert.equal(page.closed, true);
});

test("playwright browser client times out hung snapshots with the chrome-style error prefix", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/t/ZTk7Hm8ro",
        () => new Promise(() => {})
      ]
    ])
  });
  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    snapshotRetries: 0,
    snapshotTimeoutMs: 5
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/t/ZTk7Hm8ro");

  await assert.rejects(
    () => client.extractDirectVideo({
      detailTab: tab,
      video: {
        videoUrl: "https://www.tiktok.com/t/ZTk7Hm8ro",
        accountHandle: "book_seller"
      }
    }),
    /chrome_operation_timeout: domSnapshot exceeded 5ms/
  );
});

test("playwright browser client can apply humanized pauses and scrolling without changing parser results", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller/video/735111",
        "Caption: Public book video\n9.5K views\n800 likes\n31 comments\n12 shares"
      ]
    ])
  });
  page.mouse = {
    wheelCalls: [],
    async wheel(x, y) {
      this.wheelCalls.push({ x, y });
    }
  };

  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    humanize: true,
    postNavigateDelayMinMs: 0,
    postNavigateDelayMaxMs: 0,
    preSnapshotDelayMinMs: 0,
    preSnapshotDelayMaxMs: 0,
    preSnapshotScrollMinY: 120,
    preSnapshotScrollMaxY: 120
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/@book_seller/video/735111");
  const result = await client.extractDirectVideo({
    detailTab: tab,
    video: {
      videoUrl: "https://www.tiktok.com/@book_seller/video/735111",
      accountHandle: "book_seller"
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.video.views, 9500);
  assert.deepEqual(page.mouse.wheelCalls, [{ x: 0, y: 120 }]);
});

test("playwright browser client can recover direct video metrics from captured document html when the DOM snapshot shows a login wall", async () => {
  const videoUrl = "https://www.tiktok.com/@book_seller/video/7615603816745979166";
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        videoUrl,
        "Log in to TikTok to continue"
      ]
    ]),
    responseBodiesByUrl: new Map([
      [
        videoUrl,
        [
          {
            url: videoUrl,
            contentType: "text/html; charset=utf-8",
            body: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
              __DEFAULT_SCOPE__: {
                "webapp.video-detail": {
                  itemInfo: {
                    itemStruct: {
                      id: "7615603816745979166",
                      desc: "network recovered clip",
                      createTime: 1737117744,
                      author: { uniqueId: "book_seller" },
                      stats: {
                        playCount: 15000,
                        diggCount: 1200,
                        commentCount: 44,
                        shareCount: 31
                      }
                    }
                  }
                }
              }
            })}</script>`
          }
        ]
      ]
    ])
  });

  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    snapshotRetries: 0,
    snapshotRetryDelayMs: 1
  });

  const tab = await client.createTab();
  await client.navigate(tab, videoUrl);
  const result = await client.extractDirectVideo({
    detailTab: tab,
    video: {
      videoUrl,
      accountHandle: "book_seller"
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.video.views, 15000);
  assert.equal(result.video.likes, 1200);
  assert.equal(result.video.comments, 44);
  assert.equal(result.video.shares, 31);
});

test("playwright browser client falls back to account search when the profile does not expose video links", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller",
        "profile shell without any /video/ links"
      ],
      [
        "https://www.tiktok.com/search?q=%40book_seller",
        `<a href="/@book_seller/video/735111">recent clip</a>`
      ],
      [
        "https://www.tiktok.com/@book_seller/video/735111",
        "Caption: fallback search video\n15K views\n1.2K likes\n44 comments\n31 shares"
      ]
    ])
  });

  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    snapshotRetries: 0,
    snapshotRetryDelayMs: 1
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/@book_seller");
  const result = await client.extractAccountVideos({
    listTab: tab,
    detailTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].videoUrl, "https://www.tiktok.com/@book_seller/video/735111");
  assert.equal(result.videos[0].views, 15000);
  assert.equal(page.url, "https://www.tiktok.com/@book_seller/video/735111");
});

test("playwright browser client can recover profile videos from captured item_list responses", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller",
        "profile shell without any /video/ links"
      ],
      [
        "https://www.tiktok.com/@book_seller/video/7615603816745979166",
        "Caption: network recovered clip\n15K views\n1.2K likes\n44 comments\n31 shares"
      ]
    ]),
    responseBodiesByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller",
        [
          {
            url: "https://www.tiktok.com/api/post/item_list/?cursor=0",
            body: JSON.stringify({
              itemList: [
                {
                  id: "7615603816745979166",
                  createTime: 1737117744,
                  desc: "network clip",
                  author: { uniqueId: "book_seller" },
                  stats: { playCount: 15000 }
                },
                {
                  id: "1622962893630470",
                  createTime: 1737117744,
                  desc: "bad nested id",
                  author: { uniqueId: "book_seller" },
                  stats: { playCount: 999999 }
                },
                {
                  id: "322505",
                  createTime: 1737117744,
                  desc: "too short",
                  author: { uniqueId: "book_seller" },
                  stats: { playCount: 888888 }
                }
              ]
            })
          }
        ]
      ]
    ])
  });

  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    snapshotRetries: 0,
    snapshotRetryDelayMs: 1
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/@book_seller");
  const result = await client.extractAccountVideos({
    listTab: tab,
    detailTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].videoUrl, "https://www.tiktok.com/@book_seller/video/7615603816745979166");
  assert.equal(result.videos[0].views, 15000);
});

test("playwright browser client exposes captured item_list videos through extractProfileVideos", async () => {
  const page = createFakePlaywrightPage({
    snapshotSequenceByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller",
        "profile shell without any /video/ links"
      ]
    ]),
    responseBodiesByUrl: new Map([
      [
        "https://www.tiktok.com/@book_seller",
        [
          {
            url: "https://www.tiktok.com/api/post/item_list/?cursor=0",
            body: JSON.stringify({
              itemList: [
                {
                  id: "7615603816745979166",
                  createTime: 1737117744,
                  desc: "network clip",
                  author: { uniqueId: "book_seller" },
                  stats: { playCount: 15000, diggCount: 1200, commentCount: 44, shareCount: 31 }
                }
              ]
            })
          }
        ]
      ]
    ])
  });

  const client = createPlaywrightBrowserClient({
    context: {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      }
    },
    snapshotRetries: 0,
    snapshotRetryDelayMs: 1
  });

  const tab = await client.createTab();
  await client.navigate(tab, "https://www.tiktok.com/@book_seller");
  const result = await client.extractProfileVideos({
    profileTab: tab,
    account: {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    },
    maxVideos: 5
  });

  assert.equal(result.status, "ok");
  assert.equal(result.videoLinks.length, 1);
  assert.equal(result.videos.length, 1);
  assert.equal(result.videoLinks[0].views, 15000);
  assert.equal(result.videos[0].videoUrl, "https://www.tiktok.com/@book_seller/video/7615603816745979166");
  assert.equal(result.videos[0].likes, 1200);
});

function createFakePlaywrightPage({ snapshotSequenceByUrl, responseBodiesByUrl = new Map() }) {
  const snapshotReadsByUrl = new Map();
  const listeners = new Map();
  return {
    guid: "page-guid-1",
    url: "about:blank",
    waitForLoadStateCalls: [],
    on(event, handler) {
      const current = listeners.get(event) ?? [];
      current.push(handler);
      listeners.set(event, current);
    },
    async goto(url) {
      this.url = url;
      const responses = responseBodiesByUrl.get(url) ?? [];
      for (const response of responses) {
        for (const handler of listeners.get("response") ?? []) {
          await handler({
            url() {
              return response.url;
            },
            status() {
              return response.status ?? 200;
            },
            async allHeaders() {
              return {
                "content-type": response.contentType ?? "application/json; charset=utf-8"
              };
            },
            async text() {
              return response.body;
            }
          });
        }
      }
    },
    async waitForLoadState(state, options) {
      this.waitForLoadStateCalls.push({ state, ...options });
    },
    async content() {
      const snapshot = snapshotSequenceByUrl.get(this.url);
      if (typeof snapshot === "function") return snapshot();
      if (Array.isArray(snapshot)) {
        const reads = snapshotReadsByUrl.get(this.url) ?? 0;
        snapshotReadsByUrl.set(this.url, reads + 1);
        return snapshot[Math.min(reads, snapshot.length - 1)] ?? "";
      }
      return snapshot ?? "";
    },
    async close() {
      this.closed = true;
    }
  };
}
