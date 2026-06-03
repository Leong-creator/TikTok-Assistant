import assert from "node:assert/strict";
import test from "node:test";

import { ChromeTabLedger } from "../src/monitor/tab-ledger.mjs";

test("ChromeTabLedger recycles owned idle tabs without closing user tabs", async () => {
  const browser = createFakeTabBrowser();
  const ledger = new ChromeTabLedger({ browser, maxTabs: 2 });

  const listTab = await ledger.acquire("account-list");
  const detailTab = await ledger.acquire("video-detail");
  await ledger.release(detailTab.id);

  const productTab = await ledger.acquire("product-detail");

  assert.equal(browser.maxOpenOwnedTabs, 2);
  assert.equal(productTab.id, "owned-2");
  assert.deepEqual(browser.closedTabs, []);
  assert.ok(!browser.closedTabs.includes("preexisting-user-tab"));
  assert.deepEqual(
    ledger.ownedTabs().map((tab) => tab.id).sort(),
    ["owned-1", "owned-2"]
  );

  await ledger.cleanup();

  assert.deepEqual(new Set(browser.closedTabs), new Set(["owned-1", "owned-2"]));
  assert.ok(!browser.closedTabs.includes("preexisting-user-tab"));
});

test("ChromeTabLedger refuses to open past the tab limit when no owned tab is idle", async () => {
  const browser = createFakeTabBrowser();
  const ledger = new ChromeTabLedger({ browser, maxTabs: 2 });

  await ledger.acquire("account-list");
  await ledger.acquire("video-detail");

  await assert.rejects(
    () => ledger.acquire("shop-detail"),
    /chrome_tab_limit_exceeded/
  );
  assert.equal(browser.maxOpenOwnedTabs, 2);

  await ledger.cleanup();
});

test("ChromeTabLedger reuses a released idle tab even when maxTabs is one", async () => {
  const browser = createFakeTabBrowser();
  const ledger = new ChromeTabLedger({ browser, maxTabs: 1 });

  const firstTab = await ledger.acquire("account-list");
  await ledger.release(firstTab.id);
  const reusedTab = await ledger.acquire("account-list");

  assert.equal(reusedTab.id, firstTab.id);
  assert.equal(browser.maxOpenOwnedTabs, 1);
  assert.deepEqual(browser.closedTabs, []);

  await ledger.cleanup();
});

function createFakeTabBrowser() {
  let created = 0;
  const openOwnedTabs = new Set();
  const browser = {
    closedTabs: [],
    maxOpenOwnedTabs: 0,
    async createTab() {
      created += 1;
      const tab = { id: `owned-${created}` };
      openOwnedTabs.add(tab.id);
      browser.maxOpenOwnedTabs = Math.max(browser.maxOpenOwnedTabs, openOwnedTabs.size);
      return tab;
    },
    async closeTab(tab) {
      browser.closedTabs.push(tab.id);
      openOwnedTabs.delete(tab.id);
    }
  };
  return browser;
}
