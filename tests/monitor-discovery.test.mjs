import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_TIKTOK_DISCOVERY_QUERIES,
  discoverChromeAccountCandidates,
  discoverChromeShopsFromAccounts,
  mergeDiscoveredShops,
  mergeAccountCandidates,
  parseTikTokProfileShopRefs,
  parseTikTokSearchResults,
  selectQualifiedAccountCandidates
} from "../src/monitor/discovery.mjs";

test("default discovery queries cover the two target books", () => {
  assert.equal(DEFAULT_TIKTOK_DISCOVERY_QUERIES[0], "people skill");
  assert.ok(DEFAULT_TIKTOK_DISCOVERY_QUERIES.some((query) => /people skills/i.test(query)));
  assert.ok(DEFAULT_TIKTOK_DISCOVERY_QUERIES.some((query) => /street smart/i.test(query)));
});

test("parseTikTokSearchResults extracts book-related commerce account candidates", () => {
  const snapshot = `
    <a href="/@book_seller/video/761">People Skills book demo</a>
    <a href="/@book_seller">book seller profile</a>
    <a href="/shop/p/people-skills-book">Buy People Skills</a>
    <a href="/@generic_funny/video/762">random comedy</a>
    <a href="/@parenting_shop/video/763">Raise Children Street Smart book review</a>
    <a href="/shop/product/street-smart-children-book">Street Smart children book</a>
  `;

  const parsed = parseTikTokSearchResults(snapshot, {
    query: "People Skills book"
  });
  const qualified = selectQualifiedAccountCandidates(parsed.accounts);

  assert.deepEqual(qualified.map((account) => account.handle), ["book_seller", "parenting_shop"]);
  assert.ok(qualified.every((account) => account.hasCommerce));
  assert.ok(qualified.some((account) => account.relatedBooks.includes("people_skills")));
  assert.ok(qualified.some((account) => account.relatedBooks.includes("raise_children_street_smart")));
});

test("parseTikTokSearchResults treats singular people skill queries as people_skills intent", () => {
  const parsed = parseTikTokSearchResults(
    `<a href="/@book_seller/video/761">people skill book review</a><a href="/shop/book-seller">Visit shop</a>`,
    { query: "people skill" }
  );
  const qualified = selectQualifiedAccountCandidates(parsed.accounts);

  assert.equal(qualified.length, 1);
  assert.ok(qualified[0].relatedBooks.includes("people_skills"));
});

test("parseTikTokProfileShopRefs extracts active shop refs from a creator profile", () => {
  const refs = parseTikTokProfileShopRefs(
    `
      <a href="/shop/book-seller">Visit shop</a>
      <a href="/shop/p/people-skills-book">People Skills product</a>
      <div>People Skills creator showcase</div>
    `,
    {
      handle: "book_seller",
      profileUrl: "https://www.tiktok.com/@book_seller"
    }
  );

  assert.equal(refs.length, 2);
  assert.ok(refs.some((ref) => ref.shopUrl === "https://www.tiktok.com/shop/book-seller"));
  assert.ok(refs.some((ref) => ref.productUrl === "https://www.tiktok.com/shop/p/people-skills-book"));
  assert.ok(refs.every((ref) => ref.linkedHandles.includes("book_seller")));
  assert.ok(refs.some((ref) => ref.relatedBooks.includes("people_skills")));
});

test("mergeAccountCandidates writes deduped candidate seeds", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    const result = await mergeAccountCandidates({
      dataDir,
      now: new Date("2026-05-09T12:00:00.000Z"),
      candidates: [
        {
          handle: "book_seller",
          profileUrl: "https://www.tiktok.com/@book_seller",
          sourceQuery: "People Skills book",
          relatedBooks: ["people_skills"],
          hasCommerce: true,
          evidenceUrls: ["https://www.tiktok.com/@book_seller/video/761"]
        },
        {
          handle: "book_seller",
          profileUrl: "https://www.tiktok.com/@book_seller",
          sourceQuery: "Raise Children Street Smart",
          relatedBooks: ["raise_children_street_smart"],
          hasCommerce: true,
          evidenceUrls: ["https://www.tiktok.com/@book_seller/video/762"]
        }
      ]
    });

    assert.equal(result.written, 1);
    const stored = JSON.parse(await readFile(path.join(dataDir, "seeds", "account_candidates.json"), "utf8"));
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].relatedBooks.sort(), ["people_skills", "raise_children_street_smart"]);
    assert.equal(stored[0].status, "candidate");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeDiscoveredShops writes shop seeds and keeps product-only refs as disabled candidates", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-shop-discovery-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    const result = await mergeDiscoveredShops({
      dataDir,
      now: new Date("2026-05-09T12:00:00.000Z"),
      shops: [
        {
          shopUrl: "https://www.tiktok.com/shop/book-seller",
          shopName: "Book Seller",
          sourceQuery: "people skill",
          linkedHandles: ["book_seller"],
          relatedBooks: ["people_skills"]
        },
        {
          productUrl: "https://www.tiktok.com/shop/p/people-skills-book",
          sourceQuery: "people skill",
          linkedHandles: ["book_seller"],
          relatedBooks: ["people_skills"]
        }
      ]
    });

    assert.equal(result.written, 2);
    const stored = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(stored.length, 2);
    assert.equal(stored[0].enabled, true);
    assert.equal(stored[1].enabled, false);
    assert.equal(stored[1].status, "candidate");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromeAccountCandidates navigates search queries and writes qualified candidates", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-chrome-"));
  try {
    const visited = [];
    const browserClient = {
      async createTab() {
        return {
          id: "search-tab",
          currentUrl: "about:blank"
        };
      },
      async closeTab() {},
      async navigate(tab, url) {
        tab.currentUrl = url;
        visited.push(url);
      },
      async extractSearchResults({ listTab, query }) {
        assert.ok(listTab.currentUrl.includes("/search"));
        return parseTikTokSearchResults(
          `<a href="/@book_seller/video/761">People Skills book review</a>`,
          { query }
        );
      },
      async extractProfileShopRefs({ account }) {
        return [
          {
            shopUrl: "https://www.tiktok.com/shop/book-seller",
            shopName: "Book Seller",
            linkedHandles: [account.handle],
            relatedBooks: ["people_skills"]
          }
        ];
      }
    };

    const result = await discoverChromeAccountCandidates({
      dataDir,
      browserClient,
      queries: ["People Skills book"],
      now: new Date("2026-05-09T12:00:00.000Z")
    });

    assert.equal(result.queries, 1);
    assert.equal(result.candidates, 1);
    assert.equal(result.shops, 1);
    assert.ok(visited[0].startsWith("https://www.tiktok.com/search?q="));
    const stored = JSON.parse(await readFile(path.join(dataDir, "seeds", "account_candidates.json"), "utf8"));
    assert.equal(stored[0].handle, "book_seller");
    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
    assert.deepEqual(shops[0].linkedHandles, ["book_seller"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromeAccountCandidates uses query intent to probe sparse search results", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-query-intent-"));
  try {
    const browserClient = {
      async createTab() {
        return { id: "search-tab" };
      },
      async closeTab() {},
      async navigate() {},
      async extractSearchResults() {
        return parseTikTokSearchResults(`<a href="/@book_seller/video/761">watch now</a>`, { query: "people skill" });
      },
      async extractProfileShopRefs({ account }) {
        return [
          {
            shopUrl: "https://www.tiktok.com/shop/book-seller",
            linkedHandles: [account.handle]
          }
        ];
      }
    };

    const result = await discoverChromeAccountCandidates({
      dataDir,
      browserClient,
      queries: ["people skill"],
      now: new Date("2026-05-09T12:00:00.000Z")
    });

    assert.equal(result.candidates, 1);
    const stored = JSON.parse(await readFile(path.join(dataDir, "seeds", "account_candidates.json"), "utf8"));
    assert.equal(stored[0].handle, "book_seller");
    assert.ok(stored[0].relatedBooks.includes("people_skills"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromeAccountCandidates stores query candidates even when commerce refs are missing", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-no-commerce-"));
  try {
    const browserClient = {
      async createTab() {
        return { id: "search-tab" };
      },
      async closeTab() {},
      async navigate() {},
      async extractSearchResults() {
        return parseTikTokSearchResults(`<a href="/@book_seller/video/761">watch now</a>`, { query: "people skill" });
      },
      async extractProfileShopRefs() {
        return [];
      }
    };

    const result = await discoverChromeAccountCandidates({
      dataDir,
      browserClient,
      queries: ["people skill"],
      now: new Date("2026-05-09T12:00:00.000Z")
    });

    assert.equal(result.candidates, 1);
    assert.equal(result.commerceCandidates, 0);
    const stored = JSON.parse(await readFile(path.join(dataDir, "seeds", "account_candidates.json"), "utf8"));
    assert.equal(stored[0].handle, "book_seller");
    assert.equal(stored[0].hasCommerce, false);
    assert.ok(stored[0].relatedBooks.includes("people_skills"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromeAccountCandidates records a timeout failure per stuck query", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-timeout-"));
  let closed = false;
  try {
    const browserClient = {
      async createTab() {
        return { id: "search-tab" };
      },
      async closeTab() {
        closed = true;
      },
      async navigate() {
        return new Promise(() => {});
      }
    };

    const result = await discoverChromeAccountCandidates({
      dataDir,
      browserClient,
      queries: ["Raise Children Street Smart"],
      queryTimeoutMs: 1,
      now: new Date("2026-05-09T12:00:00.000Z")
    });

    assert.equal(result.candidates, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].reason, /timed out/u);
    assert.equal(closed, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromeShopsFromAccounts follows product links back to shops and writes seeds", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-discovery-shops-"));
  try {
    const browserClient = {
      async createTab() {
        return { id: "shop-tab" };
      },
      async closeTab() {},
      async navigate(tab, url) {
        tab.currentUrl = url;
      },
      async extractProfileShopRefs({ account, pageUrl }) {
        if (pageUrl === "https://www.tiktok.com/shop/p/people-skills-book") {
          return [
            {
              shopUrl: "https://www.tiktok.com/shop/book-seller",
              productUrl: "https://www.tiktok.com/shop/p/people-skills-book",
              linkedHandles: [account.handle],
              relatedBooks: account.relatedBooks
            }
          ];
        }
        return [];
      },
      async extractProfileVideos() {
        return [];
      },
      async extractDirectVideo({ video }) {
        if (video.videoUrl === "https://www.tiktok.com/@book_seller/video/761") {
          return {
            status: "ok",
            video: {
              accountHandle: "book_seller",
              videoUrl: video.videoUrl,
              views: 1000,
              likes: 100,
              comments: 10,
              shares: 5,
              productRefs: [{ productUrl: "https://www.tiktok.com/shop/p/people-skills-book" }]
            }
          };
        }
        return { status: "missing_metrics", reason: "no product refs" };
      }
    };

    const result = await discoverChromeShopsFromAccounts({
      dataDir,
      browserClient,
      accounts: [
        {
          handle: "book_seller",
          profileUrl: "https://www.tiktok.com/@book_seller",
          relatedBooks: ["people_skills"],
          sourceQuery: "people skill",
          evidenceUrls: ["https://www.tiktok.com/@book_seller/video/761"]
        }
      ],
      now: new Date("2026-05-10T01:00:00.000Z"),
      maxEvidenceVideosPerAccount: 1,
      maxProfileVideosPerAccount: 0
    });

    assert.equal(result.processedAccounts, 1);
    assert.equal(result.discoveredShops, 1);
    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops.length, 1);
    assert.equal(shops[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
    assert.equal(shops[0].productUrl, "https://www.tiktok.com/shop/p/people-skills-book");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
