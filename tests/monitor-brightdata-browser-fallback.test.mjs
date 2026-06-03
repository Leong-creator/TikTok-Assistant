import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrightDataFallbackHooks,
  resolveBrightDataBrowserEndpoint
} from "../src/monitor/brightdata-browser-fallback.mjs";

test("resolveBrightDataBrowserEndpoint prefers explicit websocket endpoint", () => {
  assert.equal(
    resolveBrightDataBrowserEndpoint({
      brightDataBrowserWsEndpoint: "wss://custom-endpoint"
    }),
    "wss://custom-endpoint"
  );
});

test("resolveBrightDataBrowserEndpoint builds endpoint from auth", () => {
  assert.equal(
    resolveBrightDataBrowserEndpoint({
      brightDataBrowserAuth: "user:pass"
    }),
    "wss://user:pass@brd.superproxy.io:9222"
  );
});

test("createBrightDataFallbackHooks uses remote browser client for profile and detail fallback", async () => {
  const calls = [];
  const hooks = await createBrightDataFallbackHooks({
    brightDataBrowserAuth: "user:pass",
    brightDataPlaywright: {
      chromium: {
        async connectOverCDP(endpoint, options) {
          calls.push({ type: "connect", endpoint, options });
          return {
            contexts() {
              return [{ kind: "remote-context" }];
            },
            async close() {
              calls.push({ type: "browser-close" });
            }
          };
        }
      }
    },
    createPlaywrightBrowserClient: ({ context }) => ({
      async createTab() {
        calls.push({ type: "create-tab", context });
        return { id: `tab-${calls.length}` };
      },
      async closeTab(tab) {
        calls.push({ type: "close-tab", tab });
      },
      async navigate(tab, url) {
        calls.push({ type: "navigate", tab, url });
      },
      async extractProfileVideos({ account }) {
        calls.push({ type: "extract-profile", account });
        return {
          status: "ok",
          videoLinks: [{ videoUrl: `${account.profileUrl}/video/1`, views: 1200 }],
          videos: []
        };
      },
      async extractDirectVideo({ video }) {
        calls.push({ type: "extract-video", video });
        return {
          status: "ok",
          video: {
            accountHandle: video.accountHandle,
            videoUrl: video.videoUrl,
            views: 9999,
            likes: 88,
            comments: 7,
            shares: 6,
            productRefs: []
          }
        };
      }
    })
  });

  const profileResult = await hooks.extractProfileVideosFallback({
    account: {
      handle: "alpha",
      profileUrl: "https://www.tiktok.com/@alpha"
    },
    primaryResult: {
      status: "missing_metrics",
      reason: "blocked"
    }
  });
  const videoResult = await hooks.extractDirectVideoFallback({
    video: {
      accountHandle: "alpha",
      videoUrl: "https://www.tiktok.com/@alpha/video/1"
    },
    primaryResult: {
      status: "login_required",
      reason: "wall"
    }
  });

  assert.equal(profileResult.status, "ok");
  assert.equal(videoResult.status, "ok");
  assert.equal(calls.filter((entry) => entry.type === "connect").length, 2);
  assert.equal(calls.filter((entry) => entry.type === "browser-close").length, 2);
});
