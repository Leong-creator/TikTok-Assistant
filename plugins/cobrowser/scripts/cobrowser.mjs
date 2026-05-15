#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resetRunProfiles } from "../lib/profile-manager.mjs";
import { resolvePaths } from "../lib/paths.mjs";
import { loadPlaywright, normalizeMode, startSession, withSession } from "../lib/runtime.mjs";
import { runActions, snapshotPage } from "../lib/page-actions.mjs";

const SMOKE_URL = "data:text/html;charset=utf-8,%3Ctitle%3ECoBrowser%20Smoke%3C%2Ftitle%3E%3Ch1%3ECoBrowser%20ready%3C%2Fh1%3E";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    if (eq !== -1) {
      args[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

async function readActions(args) {
  if (args["actions-file"]) {
    return JSON.parse(await fs.readFile(path.resolve(args["actions-file"]), "utf8"));
  }
  if (args.actions) {
    return JSON.parse(String(args.actions));
  }
  return [];
}

async function commandSetup(args) {
  const paths = resolvePaths(args.root);
  await Promise.all(Object.values(paths).map((target) => fs.mkdir(target, { recursive: true })));
  await loadPlaywright();
  return { ok: true, command: "setup", paths };
}

async function commandPaths(args) {
  const paths = resolvePaths(args.root);
  return {
    ok: true,
    command: "paths",
    paths,
    profileModel: {
      sourceProfileDir: paths.sourceProfileDir,
      runProfilesDir: paths.runProfilesDir,
      rule: "Use one machine-wide source profile for login state; use separate run profiles for individual automation tasks."
    },
    recommendedEnvironment: {
      COBROWSER_HOME: paths.root,
      TIKTOK_SHARED_SOURCE_PROFILE_DIR: paths.sourceProfileDir,
      TIKTOK_PERSISTENT_BROWSER_ROOT_DIR: paths.root,
      TIKTOK_PLAYWRIGHT_RUN_PROFILE_DIR: path.join(paths.runProfilesDir, "tiktok-monitor-run-profile-headless"),
      CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR: path.join(paths.runProfilesDir, "chatgpt-web-run-profile-headed")
    }
  };
}

async function commandLogin(args) {
  const paths = resolvePaths(args.root);
  await Promise.all(Object.values(paths).map((target) => fs.mkdir(target, { recursive: true })));
  const chromePath = await resolveChromeExecutable(args["chrome-path"]);
  const url = args.url || "https://chatgpt.com/";
  const chromeArgs = [
    `--user-data-dir=${paths.sourceProfileDir}`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    url
  ];
  const child = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref?.();
  return {
    ok: true,
    command: "login",
    pid: child.pid,
    chromePath,
    sourceProfileDir: paths.sourceProfileDir,
    url,
    instruction: "Complete login in the opened Chrome window, then close that window before running automated CoBrowser tasks."
  };
}

async function resolveChromeExecutable(explicitPath) {
  if (explicitPath && explicitPath !== true) {
    return path.resolve(String(explicitPath));
  }
  if (process.env.COBROWSER_CHROME_PATH) {
    return process.env.COBROWSER_CHROME_PATH;
  }

  const candidates = chromeCandidates();
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    return candidate;
  }

  throw new Error("Chrome executable not found. Install Google Chrome or pass --chrome-path.");
}

function chromeCandidates() {
  if (process.platform === "win32") {
    return [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Google", "Chrome", "Application", "chrome.exe")
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];
}

async function commandDoctor(args) {
  const paths = resolvePaths(args.root);
  const result = {
    ok: true,
    command: "doctor",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    paths
  };

  try {
    await loadPlaywright();
    result.playwright = "available";
  } catch (error) {
    result.ok = false;
    result.playwright = "unavailable";
    result.error = error.message;
  }

  if (toBool(args.launch, false) && result.ok) {
    await withSession({ mode: args.mode || "headless", root: args.root, fresh: true }, async ({ page }) => {
      await page.goto(SMOKE_URL);
      result.launch = await snapshotPage(page);
    });
  }

  return result;
}

async function commandSmoke(args) {
  const mode = normalizeMode(args.mode || "headless");
  const url = args.url || SMOKE_URL;
  return await withSession(
    {
      mode,
      root: args.root,
      profile: args.profile,
      fresh: toBool(args.fresh, true)
    },
    async ({ page, paths, profileDir, seed }) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(args.timeoutMs || 15000) });
      const screenshotPath = path.join(paths.screenshotsDir, `smoke-${mode}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: true,
        command: "smoke-test",
        mode,
        profileDir,
        seed,
        screenshotPath,
        snapshot: await snapshotPage(page)
      };
    }
  );
}

async function commandSource(args) {
  const mode = normalizeMode(args.mode || "headed");
  const keepOpenMs = Number(args.keepOpenMs || 120000);
  return await withSession(
    {
      mode,
      root: args.root,
      source: true,
      acceptDownloads: true
    },
    async ({ page, profileDir }) => {
      if (args.url) {
        await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: Number(args.timeoutMs || 30000) });
      }
      if (keepOpenMs > 0) {
        await page.waitForTimeout(keepOpenMs);
      }
      return {
        ok: true,
        command: "source",
        mode,
        profileDir,
        keptOpenMs: keepOpenMs,
        snapshot: await snapshotPage(page).catch(() => null)
      };
    }
  );
}

async function commandOpen(args) {
  if (!args.url) {
    throw new Error("open requires --url");
  }
  const mode = normalizeMode(args.mode || "headless");
  return await withSession(
    {
      mode,
      root: args.root,
      profile: args.profile,
      fresh: toBool(args.fresh, false)
    },
    async ({ page, profileDir, seed }) => {
      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: Number(args.timeoutMs || 30000) });
      if (args.keepOpenMs) {
        await page.waitForTimeout(Number(args.keepOpenMs));
      }
      return {
        ok: true,
        command: "open",
        mode,
        profileDir,
        seed,
        snapshot: await snapshotPage(page, { maxTextChars: Number(args.maxTextChars || 6000) })
      };
    }
  );
}

async function commandRun(args) {
  const mode = normalizeMode(args.mode || "headless");
  const actions = await readActions(args);
  if (args.url) {
    actions.unshift({ type: "goto", url: args.url, timeoutMs: Number(args.timeoutMs || 30000) });
  }
  return await withSession(
    {
      mode,
      root: args.root,
      profile: args.profile,
      fresh: toBool(args.fresh, false)
    },
    async ({ page, paths, profileDir, seed }) => ({
      ok: true,
      command: "run",
      mode,
      profileDir,
      seed,
      results: await runActions(page, actions, { screenshotsDir: paths.screenshotsDir })
    })
  );
}

async function commandTask(args) {
  if (!args.file) {
    throw new Error("task requires --file pointing to an ES module that exports run(session).");
  }
  const mode = normalizeMode(args.mode || "headless");
  const taskModule = await import(pathToFileURL(path.resolve(args.file)).href);
  if (typeof taskModule.run !== "function") {
    throw new Error("Task module must export async function run(session).");
  }
  return await withSession(
    {
      mode,
      root: args.root,
      profile: args.profile,
      fresh: toBool(args.fresh, false)
    },
    async (session) => ({
      ok: true,
      command: "task",
      mode,
      profileDir: session.profileDir,
      seed: session.seed,
      result: await taskModule.run(session)
    })
  );
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let result;

  if (command === "setup") result = await commandSetup(args);
  else if (command === "paths" || command === "profile-paths") result = await commandPaths(args);
  else if (command === "login") result = await commandLogin(args);
  else if (command === "doctor") result = await commandDoctor(args);
  else if (command === "smoke-test" || command === "smoke") result = await commandSmoke(args);
  else if (command === "source") result = await commandSource(args);
  else if (command === "open") result = await commandOpen(args);
  else if (command === "run") result = await commandRun(args);
  else if (command === "task") result = await commandTask(args);
  else if (command === "reset-run-profiles") result = { ok: true, command, ...(await resetRunProfiles({ root: args.root })) };
  else {
    result = {
      ok: true,
      commands: ["setup", "paths", "login", "doctor", "smoke-test", "source", "open", "run", "task", "reset-run-profiles"]
    };
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2)}\n`);
  process.exitCode = 1;
});
