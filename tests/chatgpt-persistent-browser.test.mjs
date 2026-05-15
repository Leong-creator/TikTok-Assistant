import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  openChatGptPersistentBrowser,
  readChatGptPersistentBrowserStatus,
  resolveChatGptPersistentBrowserConfig
} from "../src/chatgpt-persistent-browser.mjs";
import { browserSupervisionPolicySummary } from "../src/browser-supervision-policy.mjs";
import { prepareProviderTasks, startProductionRun } from "../src/app-tools.mjs";

const sampleScript = `
A young man received a huge settlement and moved into a luxury hotel.
He lived on interest while his principal stayed untouched.
Then his billionaire father taught him how relationships create money.
This story teaches children real-world financial judgment.
`;

test("resolveChatGptPersistentBrowserConfig uses a shared source profile plus a dedicated headed run profile", () => {
  const config = resolveChatGptPersistentBrowserConfig({
    cwd: "C:/Users/EDY/Desktop/TikTok Project",
    env: {
      TIKTOK_PERSISTENT_BROWSER_ROOT_DIR: "C:/browser-root",
      TIKTOK_SHARED_SOURCE_PROFILE_DIR: "C:/profiles/shared-source",
      CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR: "C:/profiles/chatgpt-headed"
    }
  });

  assert.equal(config.rootDir, path.resolve("C:/browser-root"));
  assert.equal(config.sourceProfileDir, path.resolve("C:/profiles/shared-source"));
  assert.equal(config.runProfileDir, path.resolve("C:/profiles/chatgpt-headed"));
  assert.match(config.statusFile, /chatgpt-persistent-session\.json$/);
  assert.equal(config.url, "https://chatgpt.com/");
});

test("resolveChatGptPersistentBrowserConfig prefers the CoBrowser source profile when present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-cobrowser-"));
  try {
    const projectDir = path.join(root, "TikTok Project");
    const coBrowserRoot = path.join(root, ".codex-cobrowser");
    const coBrowserSourceDir = path.join(coBrowserRoot, "source-profile");
    await mkdir(coBrowserSourceDir, { recursive: true });

    const config = resolveChatGptPersistentBrowserConfig({
      cwd: projectDir,
      env: {
        COBROWSER_HOME: coBrowserRoot
      }
    });

    assert.equal(config.rootDir, path.resolve(coBrowserRoot));
    assert.equal(config.sourceProfileDir, path.resolve(coBrowserSourceDir));
    assert.equal(
      config.runProfileDir,
      path.resolve(path.join(projectDir, ".runtime", "browser", "chatgpt-web-run-profile-headed"))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveChatGptPersistentBrowserConfig falls back to the monitor login profile when shared roots are absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-fallback-"));
  try {
    const projectDir = path.join(root, "TikTok Project");
    const monitorSourceDir = path.join(root, "TikTok Project Monitor", ".runtime", "browser", "tiktok-monitor-profile-headed");
    await mkdir(monitorSourceDir, { recursive: true });

    const config = resolveChatGptPersistentBrowserConfig({
      cwd: projectDir,
      env: {
        COBROWSER_HOME: path.join(root, "missing-cobrowser")
      }
    });

    assert.equal(config.sourceProfileDir, path.resolve(monitorSourceDir));
    assert.equal(
      config.runProfileDir,
      path.resolve(path.join(projectDir, ".runtime", "browser", "chatgpt-web-run-profile-headed"))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("openChatGptPersistentBrowser writes launching status and uses detached headed session semantics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-"));
  try {
    const calls = [];
    const result = await openChatGptPersistentBrowser({
      cwd: root,
      env: {
        TIKTOK_SHARED_SOURCE_PROFILE_DIR: path.join(root, "profiles", "shared-source"),
        CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR: path.join(root, "profiles", "chatgpt-headed")
      },
      nodePath: "node",
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return { pid: 4321, unref() {} };
      }
    });

    assert.equal(result.status, "launching");
    assert.equal(result.pid, 4321);
    assert.equal(result.backend, "playwright-persistent-headed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.stdio, "ignore");
    const status = JSON.parse(await readFile(result.statusFile, "utf8"));
    assert.equal(status.status, "launching");
    assert.equal(status.pid, 4321);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readChatGptPersistentBrowserStatus returns a not-started shaped payload before launch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-status-"));
  try {
    const status = await readChatGptPersistentBrowserStatus({ cwd: root, env: {} });
    assert.equal(status.status, "not_started");
    assert.equal(status.backend, "playwright-persistent-headed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readChatGptPersistentBrowserStatus reports stale ready state when launcher pid is gone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-stale-"));
  try {
    const statusFile = path.join(root, "runtime", "chatgpt-status.json");
    await mkdir(path.dirname(statusFile), { recursive: true });
    await writeFile(statusFile, JSON.stringify({
      status: "ready",
      pid: 987654,
      backend: "playwright-persistent-headed",
      sourceProfileDir: "old-source",
      runProfileDir: "old-run",
      url: "https://chatgpt.com/"
    }), "utf8");

    const status = await readChatGptPersistentBrowserStatus({
      cwd: root,
      env: {
        CHATGPT_PERSISTENT_STATUS_FILE: statusFile,
        COBROWSER_HOME: path.join(root, "missing-cobrowser")
      },
      isProcessRunning: () => false
    });

    assert.equal(status.status, "stopped");
    assert.equal(status.previousStatus, "ready");
    assert.equal(status.sourceProfileDir, path.resolve(path.join(root, "missing-cobrowser", "source-profile")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser supervision policy now describes persistent split visibility instead of the chrome plugin", () => {
  const policy = browserSupervisionPolicySummary();

  assert.equal(policy.id, "persistent-browser-split-runtime-v1");
  assert.equal(policy.backend, "playwright-persistent");
  assert.equal(policy.chatgptWeb.mode, "headed-persistent-session");
  assert.equal(policy.tiktokMonitoring.mode, "headless-persistent-session");
});

test("app tools and provider task files point ChatGPT work to the headed persistent browser session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-chatgpt-browser-tasks-"));
  try {
    const started = await startProductionRun({
      script: sampleScript,
      outputRoot: root,
      slug: "persistent-chatgpt",
      now: new Date("2026-05-14T00:00:00+08:00")
    });
    const appRun = JSON.parse(await readFile(path.join(started.packageDir, "07_review_log", "app_run.json"), "utf8"));
    assert.equal(appRun.browserSupervisionPolicy.backend, "playwright-persistent");

    const prepared = await prepareProviderTasks({
      script: sampleScript,
      outputRoot: root,
      slug: "persistent-chatgpt-tasks",
      mode: "calibration",
      provider: "image-mvp",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      now: new Date("2026-05-14T00:00:00+08:00")
    });

    const task = JSON.parse(
      await readFile(path.join(prepared.packageDir, "07_review_log", "chatgpt_web_tasks", "S001_a1.json"), "utf8")
    );
    const session = JSON.parse(await readFile(path.join(prepared.packageDir, "07_review_log", "chatgpt_session.json"), "utf8"));

    assert.match(task.requiredBrowserStep, /headed persistent/i);
    assert.equal(task.browserSupervisionPolicy.backend, "playwright-persistent");
    assert.equal(session.status, "prepared-by-app");
    assert.match(session.requiredBrowserStep, /headed persistent/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
