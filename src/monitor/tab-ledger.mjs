export class ChromeTabLedger {
  constructor({ browser, maxTabs = 2 } = {}) {
    if (!browser?.createTab || !browser?.closeTab) {
      throw new Error("browser with createTab and closeTab is required");
    }
    this.browser = browser;
    this.maxTabs = Math.max(1, Number(maxTabs || 2));
    this.tabs = new Map();
    this.sequence = 0;
  }

  async acquire(purpose = "collector") {
    if (this.tabs.size >= this.maxTabs) {
      await this.recycleIdleTab();
    }

    const reusable = this.findIdleTab();
    if (reusable && this.tabs.size < this.maxTabs) {
      reusable.status = "busy";
      reusable.purpose = purpose;
      reusable.lastUsedOrder = ++this.sequence;
      return reusable.tab;
    }

    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`chrome_tab_limit_exceeded: max owned tabs is ${this.maxTabs}`);
    }

    const tab = await this.browser.createTab({ purpose });
    this.tabs.set(tab.id, {
      id: tab.id,
      tab,
      purpose,
      status: "busy",
      createdOrder: ++this.sequence,
      lastUsedOrder: this.sequence
    });
    return tab;
  }

  async release(tabId) {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    entry.status = "idle";
    entry.lastUsedOrder = ++this.sequence;
  }

  ownedTabs() {
    return [...this.tabs.values()].map((entry) => ({
      id: entry.id,
      purpose: entry.purpose,
      status: entry.status
    }));
  }

  async cleanup() {
    const entries = [...this.tabs.values()];
    this.tabs.clear();
    for (const entry of entries) {
      await this.browser.closeTab(entry.tab);
    }
  }

  findIdleTab() {
    return [...this.tabs.values()]
      .filter((entry) => entry.status === "idle")
      .sort((left, right) => left.lastUsedOrder - right.lastUsedOrder)[0];
  }

  async recycleIdleTab() {
    const idle = this.findIdleTab();
    if (!idle) return;
    this.tabs.delete(idle.id);
    await this.browser.closeTab(idle.tab);
  }
}
