# ChatGPT Persistent Browser Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ChatGPT web image work off the Codex Chrome plugin and onto the same OpenClaw-style persistent Chrome family already used for TikTok monitoring, while keeping TikTok headless and ChatGPT headed able to run at the same time.

**Architecture:** Introduce a shared persistent-browser profile convention: one reusable source profile plus separate automation-owned run profiles for TikTok monitor and ChatGPT web. Reuse the OpenClaw-style clone-and-launch flow for both, but keep ChatGPT headed and TikTok headless. Update project policy, task metadata, and CLIs so browser defaults point to this new split instead of the Chrome plugin.

**Tech Stack:** Node.js, persistent Playwright Chrome contexts, existing JSON task files, existing monitor/browser runtime modules, OpenClaw profile-clone pattern.

---

### Task 1: Add shared persistent-browser profile config and runtime helpers

**Files:**
- Create: `C:\Users\EDY\Desktop\TikTok Project\src\persistent-browser-runtime.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project Monitor\src\monitor\playwright-persistent-runtime.mjs`
- Test: `C:\Users\EDY\Desktop\TikTok Project Monitor\tests\monitor-playwright-runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Add coverage for separate source/run profile resolution and headed/headless launch presets.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-playwright-runtime.test.mjs`
Expected: FAIL because shared profile resolution helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create a reusable runtime module in the main project and extend the monitor runtime to expose:
- `resolvePersistentBrowserProfiles()`
- `createHeadedChatGptLaunchOptions()`
- `createHeadlessTikTokLaunchOptions()`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/monitor-playwright-runtime.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/persistent-browser-runtime.mjs src/monitor/playwright-persistent-runtime.mjs tests/monitor-playwright-runtime.test.mjs
git commit -m "feat: share persistent browser profile runtime"
```

### Task 2: Add ChatGPT persistent session bootstrap in the main project

**Files:**
- Create: `C:\Users\EDY\Desktop\TikTok Project\src\chatgpt-persistent-browser.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project\src\cli.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project\package.json`
- Test: `C:\Users\EDY\Desktop\TikTok Project\tests\chatgpt-persistent-browser.test.mjs`

- [ ] **Step 1: Write the failing test**

Add CLI/runtime tests for `chatgpt-browser-open` and `chatgpt-browser-status`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chatgpt-persistent-browser.test.mjs`
Expected: FAIL because the ChatGPT persistent browser module and commands do not exist.

- [ ] **Step 3: Write minimal implementation**

Expose commands that:
- clone from the shared source profile into a ChatGPT run profile
- launch headed Chrome with `channel: "chrome"`
- open or reuse `https://chatgpt.com/`
- report profile paths and mode

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chatgpt-persistent-browser.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chatgpt-persistent-browser.mjs src/cli.mjs package.json tests/chatgpt-persistent-browser.test.mjs
git commit -m "feat: add headed ChatGPT persistent browser session"
```

### Task 3: Point content-pipeline metadata at the new browser path

**Files:**
- Modify: `C:\Users\EDY\Desktop\TikTok Project\src\browser-supervision-policy.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project\src\pipeline.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project\src\app-tools.mjs`
- Test: `C:\Users\EDY\Desktop\TikTok Project\tests\chatgpt-persistent-browser.test.mjs`

- [ ] **Step 1: Write the failing test**

Assert that ChatGPT task/session JSON and browser policy no longer claim the Codex Chrome plugin is the default backend.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chatgpt-persistent-browser.test.mjs`
Expected: FAIL because metadata still says Chrome plugin / browser adapter required.

- [ ] **Step 3: Write minimal implementation**

Update browser policy and task manifests so ChatGPT work says:
- default backend = `playwright-persistent-headed`
- shared source profile + dedicated run profile
- manual review/download still happen in a visible browser window

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chatgpt-persistent-browser.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/browser-supervision-policy.mjs src/pipeline.mjs src/app-tools.mjs tests/chatgpt-persistent-browser.test.mjs
git commit -m "feat: migrate ChatGPT browser metadata to persistent sessions"
```

### Task 4: Align monitor config with the shared source profile contract

**Files:**
- Modify: `C:\Users\EDY\Desktop\TikTok Project Monitor\src\monitor\config.mjs`
- Modify: `C:\Users\EDY\Desktop\TikTok Project Monitor\.env.example`
- Modify: `C:\Users\EDY\Desktop\TikTok Project Monitor\README.md`
- Test: `C:\Users\EDY\Desktop\TikTok Project Monitor\tests\monitor-config.test.mjs`

- [ ] **Step 1: Write the failing test**

Add coverage for shared source profile env vars and separate TikTok/ChatGPT run profile defaults.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/monitor-config.test.mjs`
Expected: FAIL because config only knows one generic Playwright profile.

- [ ] **Step 3: Write minimal implementation**

Expose env/config for:
- shared source profile
- TikTok headless run profile
- ChatGPT headed run profile

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/monitor-config.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor/config.mjs .env.example README.md tests/monitor-config.test.mjs
git commit -m "feat: align monitor config with shared browser profiles"
```

### Task 5: Verify and document concurrent operation

**Files:**
- Modify: `C:\Users\EDY\Desktop\TikTok Project\README.md`
- Modify: `C:\Users\EDY\Desktop\TikTok Project Monitor\README.md`
- Test: `C:\Users\EDY\Desktop\TikTok Project\tests\chatgpt-persistent-browser.test.mjs`
- Test: `C:\Users\EDY\Desktop\TikTok Project Monitor\tests\monitor-playwright-runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Assert docs/examples reference the concurrent model: TikTok headless plus ChatGPT headed from the same source profile family.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on doc/config expectation updates.

- [ ] **Step 3: Write minimal implementation**

Document:
- same source profile, separate run profiles
- TikTok monitor can run headless while ChatGPT stays visible
- no Chrome plugin dependency for either default workflow

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md ../TikTok\ Project\ Monitor/README.md tests/chatgpt-persistent-browser.test.mjs tests/monitor-playwright-runtime.test.mjs
git commit -m "docs: document shared persistent browser operations"
```
