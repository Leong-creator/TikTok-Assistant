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

function createFakeChromeClient({ accountResponses, shopResponses }) {
  let created = 0;
  const client = {
    openTabs: new Set(),
    closedTabs: [],
    maxOpenTabs: 0,
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
    async extractAccountVideos(tab, account) {
      return accountResponses.get(account.handle) ?? { status: "ok", videos: [] };
    },
    async extractShopProducts(tab, shop) {
      return shopResponses.get(shop.name) ?? { status: "ok", products: [] };
    }
  };
  return client;
}
