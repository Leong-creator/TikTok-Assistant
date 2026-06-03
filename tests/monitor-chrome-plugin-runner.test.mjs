import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildChromePluginMonitorPlan,
  discoverChromePluginCandidates,
  discoverChromePluginShopsFromAccounts,
  runChromePluginMonitorBatch,
  runChromePluginMonitor
} from "../src/monitor/chrome-plugin-runner.mjs";

const VIDEO_ALPHA = "7615603816745979166";
const VIDEO_BETA = "7623225588626590990";
const VIDEO_RECENT = "7637752368508685589";

test("runChromePluginMonitor wraps a Chrome plugin browser and runs the monitor loop", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-plugin-runner-"));
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
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      JSON.stringify({
        collectedAt: "2026-05-09T06:00:00.000Z",
        source: "chrome",
        accountHandle: "book_alpha",
        videoUrl: `https://www.tiktok.com/@book_alpha/video/${VIDEO_RECENT}`,
        caption: "Public book video",
        postedAt: "2026-05-09T05:00:00.000Z",
        views: 1000,
        likes: 20,
        comments: 1,
        shares: 1,
        productRefs: []
      }) + "\n"
    );

    const browser = createFakePluginBrowser(
      new Map([
        ["https://www.tiktok.com/@book_alpha", `<a href="/@book_alpha/video/${VIDEO_RECENT}">one</a>`],
        [
          `https://www.tiktok.com/@book_alpha/video/${VIDEO_RECENT}`,
          "Caption: Public book video\n12.4K views\n1.2K likes\n88 comments\n35 shares"
        ]
      ])
    );
    const alerts = [];
    const result = await runChromePluginMonitor({
      browser,
      dataDir,
      targets: ["accounts"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      alertRecipient: "ou_test_user",
      notifier: {
        async send(alert) {
          alerts.push(alert);
          return { status: "sent", messageId: "dry-run" };
        }
      }
    });

    assert.equal(result.source, "chrome");
    assert.equal(browser.maxOpenTabs, 2);
    assert.ok(alerts.length > 0);
    const signalLog = await readFile(path.join(dataDir, "signals", "signals.jsonl"), "utf8");
    assert.match(signalLog, /book_alpha/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runChromePluginMonitor forwards Chrome bridge timing config", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-plugin-runner-config-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const browser = createFakePluginBrowser(
      new Map([
        ["https://www.tiktok.com/@book_alpha", `<a href="/@book_alpha/video/${VIDEO_ALPHA}">one</a>`],
        [
          `https://www.tiktok.com/@book_alpha/video/${VIDEO_ALPHA}`,
          "Caption: Public book video\n12.4K views\n1.2K likes\n88 comments\n35 shares"
        ]
      ])
    );

    await runChromePluginMonitor({
      browser,
      dataDir,
      targets: ["accounts"],
      now: new Date("2026-05-09T12:00:00.000Z"),
      notifier: { async send() {} },
      config: {
        waitUntil: "load",
        timeoutMs: 4321,
        snapshotRetries: 0,
        snapshotRetryDelayMs: 1
      }
    });

    assert.ok(browser.waitForLoadStateCalls.length > 0);
    assert.ok(browser.waitForLoadStateCalls.every((call) => call.state === "load" && call.timeoutMs === 4321));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createFakePluginBrowser(snapshotsByUrl) {
  let created = 0;
  const browser = {
    openTabs: new Set(),
    maxOpenTabs: 0,
    waitForLoadStateCalls: [],
    tabs: {
      async new() {
        created += 1;
        const tab = {
          id: `tab-${created}`,
          currentUrl: "about:blank",
          async goto(url) {
            tab.currentUrl = url;
          },
          async close() {
            browser.openTabs.delete(tab.id);
          },
          playwright: {
            async waitForLoadState(options) {
              browser.waitForLoadStateCalls.push(options);
            },
            async domSnapshot() {
              return snapshotsByUrl.get(tab.currentUrl) ?? "";
            }
          }
        };
        browser.openTabs.add(tab.id);
        browser.maxOpenTabs = Math.max(browser.maxOpenTabs, browser.openTabs.size);
        return tab;
      }
    }
  };
  return browser;
}

test("discoverChromePluginCandidates writes search account candidates through the Chrome plugin bridge", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-plugin-discovery-"));
  try {
    const browser = createFakePluginBrowser(
      new Map([
        [
          "https://www.tiktok.com/search?q=People+Skills+book",
          `<a href="/@book_seller/video/${VIDEO_ALPHA}">People Skills book review</a>`
        ],
        [
          "https://www.tiktok.com/@book_seller",
          `<a href="/shop/book-seller">Visit shop</a><a href="/shop/p/people-skills">Buy</a>`
        ]
      ])
    );

    const result = await discoverChromePluginCandidates({
      browser,
      dataDir,
      queries: ["People Skills book"],
      now: new Date("2026-05-09T12:00:00.000Z")
    });

    assert.equal(result.candidates, 1);
    assert.equal(result.shops, 2);
    const candidates = JSON.parse(await readFile(path.join(dataDir, "seeds", "account_candidates.json"), "utf8"));
    assert.equal(candidates[0].handle, "book_seller");
    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops.length, 2);
    assert.equal(shops[0].enabled, true);
    assert.equal(shops[1].status, "candidate");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("discoverChromePluginShopsFromAccounts writes shops discovered from evidence videos", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-plugin-shop-discovery-"));
  try {
    const browser = createFakePluginBrowser(
      new Map([
        ["https://www.tiktok.com/@book_seller", `<div>profile</div>`],
        [
          "https://www.tiktok.com/@book_seller/video/7615603816745979166",
          `Caption: People Skills\n12.4K views\n1.2K likes\n88 comments\n35 shares\n<a href="/shop/p/people-skills-book">Buy</a>`
        ],
        [
          "https://www.tiktok.com/shop/p/people-skills-book",
          `<a href="/shop/book-seller">Book Seller</a><a href="/shop/p/people-skills-book">Product</a>`
        ]
      ])
    );

    const result = await discoverChromePluginShopsFromAccounts({
      browser,
      dataDir,
      accounts: [
        {
          handle: "book_seller",
          profileUrl: "https://www.tiktok.com/@book_seller",
          relatedBooks: ["people_skills"],
          sourceQuery: "people skill",
          evidenceUrls: ["https://www.tiktok.com/@book_seller/video/7615603816745979166"]
        }
      ],
      now: new Date("2026-05-10T01:00:00.000Z"),
      config: {
        maxEvidenceVideosPerAccount: 1,
        maxProfileVideosPerAccount: 0
      }
    });

    assert.equal(result.discoveredShops, 1);
    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops[0].shopUrl, "https://www.tiktok.com/shop/book-seller");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runChromePluginMonitorBatch persists one bounded batch and advances cursor", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-plugin-batch-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true,
          evidenceUrls: [`https://www.tiktok.com/@book_alpha/video/${VIDEO_ALPHA}`]
        },
        {
          id: "account-beta",
          handle: "book_beta",
          profileUrl: "https://www.tiktok.com/@book_beta",
          enabled: true
        }
      ])
    );
    await writeFile(path.join(dataDir, "seeds", "shops.json"), JSON.stringify([]));

    const browser = createFakePluginBrowser(
      new Map([
        [
          `https://www.tiktok.com/@book_alpha/video/${VIDEO_ALPHA}`,
          "Caption: Public book video\n12.4K views\n1.2K likes\n88 comments\n35 shares"
        ],
        [
          "https://www.tiktok.com/@book_beta",
          `<a href="/@book_beta/video/${VIDEO_BETA}">two</a>`
        ],
        [
          `https://www.tiktok.com/@book_beta/video/${VIDEO_BETA}`,
          "Caption: Second book video\n10.1K views\n950 likes\n41 comments\n22 shares"
        ]
      ])
    );

    const plan = await buildChromePluginMonitorPlan({
      dataDir,
      now: new Date("2026-05-12T05:00:00.000Z")
    });
    assert.equal(plan.counts.videoTargets, 1);
    assert.equal(plan.counts.accountTargets, 2);

    const first = await runChromePluginMonitorBatch({
      browser,
      dataDir,
      now: new Date("2026-05-12T05:00:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1
      }
    });
    assert.equal(first.batch.videos, 0);
    assert.equal(first.batch.accounts, 1);
    assert.equal(first.snapshots.video, 1);

    const second = await runChromePluginMonitorBatch({
      browser,
      dataDir,
      now: new Date("2026-05-12T05:10:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1
      }
    });
    assert.equal(second.batch.videos, 0);
    assert.equal(second.batch.accounts, 1);
    assert.equal(second.snapshots.video, 0);

    const third = await runChromePluginMonitorBatch({
      browser,
      dataDir,
      now: new Date("2026-05-12T05:20:00.000Z"),
      config: {
        maxSeedVideos: 1,
        maxAccounts: 1
      }
    });
    assert.equal(third.batch.videos, 1);
    assert.equal(third.batch.accounts, 0);
    assert.equal(third.snapshots.video, 1);

    const snapshotLog = await readFile(path.join(dataDir, "snapshots", "video_snapshots.jsonl"), "utf8");
    assert.equal(snapshotLog.trim().split("\n").length, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
