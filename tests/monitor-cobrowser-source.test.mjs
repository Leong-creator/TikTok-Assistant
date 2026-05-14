import assert from "node:assert/strict";
import test from "node:test";

import { collectCoBrowserSnapshots } from "../src/monitor/cobrowser-source.mjs";

test("collectCoBrowserSnapshots launches a CoBrowser session and annotates snapshot sources", async () => {
  const calls = [];
  const session = {
    context: { marker: "context" },
    async close() {
      calls.push("closed");
    }
  };

  const result = await collectCoBrowserSnapshots({
    videos: [
      {
        accountHandle: "book_alpha",
        videoUrl: "https://www.tiktok.com/@book_alpha/video/1"
      }
    ],
    config: {
      startCoBrowserSession: async (options) => {
        calls.push(options);
        return session;
      },
      createPlaywrightBrowserClient: ({ context }) => ({ context }),
      collectChromeSnapshots: async ({ videos }) => ({
        source: "ignored",
        collectedAt: "2026-05-14T10:00:00.000Z",
        videoSnapshots: videos.map((video) => ({
          collectedAt: "2026-05-14T10:00:00.000Z",
          accountHandle: video.accountHandle,
          videoUrl: video.videoUrl,
          views: 1,
          likes: 2,
          comments: 3,
          shares: 4,
          productRefs: []
        })),
        productSnapshots: [],
        failures: []
      })
    }
  });

  assert.equal(result.source, "cobrowser");
  assert.equal(result.videoSnapshots[0].source, "cobrowser");
  assert.equal(calls[0].mode, "headless");
  assert.deepEqual(calls.at(-1), "closed");
});
