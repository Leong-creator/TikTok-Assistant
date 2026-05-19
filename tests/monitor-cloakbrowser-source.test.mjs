import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { collectCloakBrowserSnapshots } from "../src/monitor/cloakbrowser-source.mjs";

test("collectCloakBrowserSnapshots launches a CloakBrowser context and annotates snapshot sources", async () => {
  const profileRoot = await mkdtemp(path.join(tmpdir(), "tk-cloak-source-"));
  const calls = [];
  const context = {
    async close() {
      calls.push("closed");
    }
  };

  try {
    const sourceProfileDir = path.join(profileRoot, "source");
    const runProfileDir = path.join(profileRoot, "run");
    await mkdir(sourceProfileDir, { recursive: true });

    const result = await collectCloakBrowserSnapshots({
      videos: [
        {
          accountHandle: "book_alpha",
          videoUrl: "https://www.tiktok.com/@book_alpha/video/1"
        }
      ],
      config: {
        cloakbrowserProfileDir: runProfileDir,
        cloakbrowserSourceProfileDir: sourceProfileDir,
        launchCloakBrowserPersistentContext: async (options) => {
          calls.push(options);
          return context;
        },
        createPlaywrightBrowserClient: ({ context: browserContext }) => ({ context: browserContext }),
        collectChromeSnapshots: async ({ videos }) => ({
          source: "ignored",
          collectedAt: "2026-05-16T10:00:00.000Z",
          videoSnapshots: videos.map((video) => ({
            collectedAt: "2026-05-16T10:00:00.000Z",
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

    assert.equal(result.source, "cloakbrowser");
    assert.equal(result.videoSnapshots[0].source, "cloakbrowser");
    assert.equal(calls[0].userDataDir, runProfileDir);
    assert.equal(calls[0].headless, true);
    assert.equal(calls[0].humanize, true);
    assert.deepEqual(calls.at(-1), "closed");
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
});
