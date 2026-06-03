import assert from "node:assert/strict";
import test from "node:test";

import { collectChromeSnapshots } from "../src/monitor/chrome-source.mjs";

test("collectChromeSnapshots records login_required without throwing and cleans owned tabs", async () => {
  const browserClient = createFakeChromeClient({
    accountResponses: new Map([
      [
        "public_books",
        {
          status: "login_required",
          reason: "public page hid video metrics"
        }
      ]
    ]),
    shopResponses: new Map()
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 2,
    browserClient,
    accounts: [
      {
        handle: "public_books",
        profileUrl: "https://www.tiktok.com/@public_books",
        enabled: true
      }
    ],
    shops: []
  });

  assert.equal(result.videoSnapshots.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].status, "login_required");
  assert.match(result.failures[0].reason, /hid video metrics/);
  assert.equal(browserClient.maxOpenTabs, 1);
  assert.equal(browserClient.openTabs.size, 0);
});

test("collectChromeSnapshots reuses the list tab for account extraction when maxTabs is one", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map()
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    accounts: [
      {
        handle: "single_tab_account",
        profileUrl: "https://www.tiktok.com/@single_tab_account",
        enabled: true
      }
    ],
    shops: []
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].videoUrl, "https://www.tiktok.com/@single_tab_account/video/generated");
  assert.equal(browserClient.maxOpenTabs, 1);
  assert.equal(browserClient.openTabs.size, 0);
});

test("collectChromeSnapshots skips detail refresh when homepage views change is below threshold", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    profileVideoLinks: new Map([
      [
        "steady_account",
        [
          {
            videoUrl: "https://www.tiktok.com/@steady_account/video/generated",
            views: 1450
          }
        ]
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    accounts: [
      {
        handle: "steady_account",
        profileUrl: "https://www.tiktok.com/@steady_account",
        enabled: true,
        knownVideos: [
          {
            videoUrl: "https://www.tiktok.com/@steady_account/video/generated",
            views: 1000,
            likes: 22,
            comments: 3,
            shares: 4,
            caption: "Previous snapshot",
            postedAt: "2026-05-08T00:00:00.000Z",
            productRefs: []
          }
        ]
      }
    ],
    shops: [],
    config: {
      profileViewDeltaThreshold: 1000
    }
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].views, 1450);
  assert.equal(result.videoSnapshots[0].likes, 22);
  assert.equal(browserClient.directVideoCalls, 0);
});

test("collectChromeSnapshots uses preloaded profile videos without opening detail pages", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    profileVideoLinks: new Map([
      [
        "preloaded_account",
        {
          status: "ok",
          videoLinks: [
            {
              videoUrl: "https://www.tiktok.com/@preloaded_account/video/generated",
              views: 1450
            }
          ],
          videos: [
            {
              accountHandle: "preloaded_account",
              videoUrl: "https://www.tiktok.com/@preloaded_account/video/generated",
              caption: "Recovered from profile payload",
              postedAt: "2026-05-08T00:00:00.000Z",
              views: 1450,
              likes: 33,
              comments: 4,
              shares: 5,
              productRefs: []
            }
          ]
        }
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    accounts: [
      {
        handle: "preloaded_account",
        profileUrl: "https://www.tiktok.com/@preloaded_account",
        enabled: true
      }
    ],
    shops: []
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].likes, 33);
  assert.equal(browserClient.directVideoCalls, 0);
});

test("collectChromeSnapshots uses profile fallback when the primary profile extractor does not expose video links", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    profileVideoLinks: new Map([
      [
        "fallback_account",
        {
          status: "missing_metrics",
          reason: "public profile did not expose video links"
        }
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    accounts: [
      {
        handle: "fallback_account",
        profileUrl: "https://www.tiktok.com/@fallback_account",
        enabled: true
      }
    ],
    shops: [],
    config: {
      extractProfileVideosFallback: async ({ account, primaryResult }) => {
        assert.equal(account.handle, "fallback_account");
        assert.equal(primaryResult.status, "missing_metrics");
        return {
          status: "ok",
          videoLinks: [
            {
              videoUrl: "https://www.tiktok.com/@fallback_account/video/from-dokobot",
              views: 1200
            }
          ]
        };
      }
    }
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].videoUrl, "https://www.tiktok.com/@fallback_account/video/from-dokobot");
  assert.equal(browserClient.directVideoCalls, 1);
});

test("collectChromeSnapshots uses direct video fallback when the primary detail extractor is blocked", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    directVideoResponses: new Map([
      [
        "https://www.tiktok.com/@blocked/video/123",
        {
          status: "login_required",
          reason: "TikTok public page requires login for this data"
        }
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    videos: [
      {
        accountHandle: "blocked",
        videoUrl: "https://www.tiktok.com/@blocked/video/123",
        enabled: true
      }
    ],
    config: {
      extractDirectVideoFallback: async ({ video, primaryResult }) => {
        assert.equal(video.accountHandle, "blocked");
        assert.equal(primaryResult.status, "login_required");
        return {
          status: "ok",
          video: {
            accountHandle: "blocked",
            videoUrl: "https://www.tiktok.com/@blocked/video/123",
            views: 2200,
            likes: 31,
            comments: 7,
            shares: 5,
            productRefs: []
          }
        };
      }
    }
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.videoSnapshots.length, 1);
  assert.equal(result.videoSnapshots[0].views, 2200);
  assert.equal(result.videoSnapshots[0].likes, 31);
});

test("collectChromeSnapshots ignores Dokobot fallback errors and keeps the original failure", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    directVideoResponses: new Map([
      [
        "https://www.tiktok.com/@blocked/video/123",
        {
          status: "login_required",
          reason: "TikTok public page requires login for this data"
        }
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    videos: [
      {
        accountHandle: "blocked",
        videoUrl: "https://www.tiktok.com/@blocked/video/123",
        enabled: true
      }
    ],
    config: {
      extractDirectVideoFallback: async () => {
        throw new Error("Dokobot unavailable");
      }
    }
  });

  assert.equal(result.videoSnapshots.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].status, "login_required");
});

test("collectChromeSnapshots stops a video-only batch early after repeated login_required failures", async () => {
  const browserClient = createFakeChromeClient({
    usesDetailTab: true,
    accountResponses: new Map(),
    shopResponses: new Map(),
    directVideoResponses: new Map([
      [
        "https://www.tiktok.com/@blocked/video/1",
        {
          status: "login_required",
          reason: "TikTok public page requires login for this data"
        }
      ],
      [
        "https://www.tiktok.com/@blocked/video/2",
        {
          status: "login_required",
          reason: "TikTok public page requires login for this data"
        }
      ]
    ])
  });

  const result = await collectChromeSnapshots({
    now: new Date("2026-05-09T12:00:00.000Z"),
    maxTabs: 1,
    browserClient,
    videos: [
      {
        accountHandle: "blocked",
        videoUrl: "https://www.tiktok.com/@blocked/video/1",
        enabled: true
      },
      {
        accountHandle: "blocked",
        videoUrl: "https://www.tiktok.com/@blocked/video/2",
        enabled: true
      },
      {
        accountHandle: "blocked",
        videoUrl: "https://www.tiktok.com/@blocked/video/3",
        enabled: true
      }
    ],
    config: {
      recycleLoginRequiredThreshold: 2
    }
  });

  assert.equal(result.videoSnapshots.length, 0);
  assert.equal(result.failures.length, 2);
  assert.equal(result.processed.videoTargets, 2);
  assert.equal(result.recycleRequested, true);
  assert.equal(result.stopReason, "login_required_threshold");
  assert.equal(browserClient.directVideoCalls, 2);
});

function createFakeChromeClient({
  accountResponses,
  shopResponses,
  profileVideoLinks = new Map(),
  directVideoResponses = new Map(),
  usesDetailTab = false
}) {
  let created = 0;
  const client = {
    usesDetailTab,
    openTabs: new Set(),
    closedTabs: [],
    maxOpenTabs: 0,
    directVideoCalls: 0,
    async createTab() {
      created += 1;
      const tab = { id: `chrome-owned-${created}` };
      client.openTabs.add(tab.id);
      client.maxOpenTabs = Math.max(client.maxOpenTabs, client.openTabs.size);
      return tab;
    },
    async closeTab(tab) {
      client.closedTabs.push(tab.id);
      client.openTabs.delete(tab.id);
    },
    async navigate(tab, url) {
      tab.url = url;
    },
    async extractProfileVideos({ account }) {
      const scriptedAccountResponse = accountResponses.get(account.handle);
      if (scriptedAccountResponse && scriptedAccountResponse.status && scriptedAccountResponse.status !== "ok") {
        return scriptedAccountResponse;
      }
      if (profileVideoLinks.has(account.handle)) {
        const scripted = profileVideoLinks.get(account.handle);
        if (Array.isArray(scripted)) {
          return {
            status: "ok",
            videoLinks: scripted
          };
        }
        return scripted;
      }
      return {
        status: "ok",
        videoLinks: [
          {
            videoUrl: `${account.profileUrl}/video/generated`,
            views: 1
          }
        ]
      };
    },
    async extractAccountVideos(tabOrPayload, accountArg) {
      const account = accountArg ?? tabOrPayload.account;
      return accountResponses.get(account.handle) ?? {
        status: "ok",
        videos: [
          {
            accountHandle: account.handle,
            videoUrl: `${account.profileUrl}/video/generated`,
            views: 1,
            likes: 2,
            comments: 3,
            shares: 4,
            productRefs: []
          }
        ]
      };
    },
    async extractDirectVideo({ video }) {
      client.directVideoCalls += 1;
      if (directVideoResponses.has(video.videoUrl)) {
        return directVideoResponses.get(video.videoUrl);
      }
      return {
        status: "ok",
        video: {
          accountHandle: video.accountHandle,
          videoUrl: video.videoUrl,
          views: 2000,
          likes: 30,
          comments: 5,
          shares: 6,
          productRefs: []
        }
      };
    },
    async extractShopProducts(tab, shop) {
      return shopResponses.get(shop.name) ?? { status: "ok", products: [] };
    }
  };
  return client;
}
