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
  assert.equal(videos[0].videoUrl, "https://www.tiktok.com/@book_seller/video/735111");
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

function createFakePlaywrightPage({ snapshotSequenceByUrl }) {
  const snapshotReadsByUrl = new Map();
  return {
    guid: "page-guid-1",
    url: "about:blank",
    waitForLoadStateCalls: [],
    async goto(url) {
      this.url = url;
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
