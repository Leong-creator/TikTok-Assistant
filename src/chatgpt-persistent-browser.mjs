import fs from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultPersistentBrowserRoot, resolvePersistentBrowserProfiles } from "./persistent-browser-runtime.mjs";

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const LAUNCHER_PATH = fileURLToPath(new URL("./chatgpt-persistent-browser-launcher.mjs", import.meta.url));

export function resolveChatGptPersistentBrowserConfig({
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const resolvedCwd = path.resolve(cwd);
  const runtimeDir = path.resolve(env.CHATGPT_PERSISTENT_RUNTIME_DIR ?? path.join(resolvedCwd, ".runtime", "browser"));
  const hasExplicitSharedRoot = Boolean(env.TIKTOK_PERSISTENT_BROWSER_ROOT_DIR);
  const sharedRoot = env.TIKTOK_PERSISTENT_BROWSER_ROOT_DIR ?? defaultPersistentBrowserRoot();
  const coBrowserRoot = resolveCoBrowserRoot(env);
  const rootDir = hasExplicitSharedRoot || fs.existsSync(sharedRoot)
    ? sharedRoot
    : fs.existsSync(coBrowserRoot)
      ? coBrowserRoot
      : runtimeDir;
  const sourceProfileDir = resolveSourceProfileDir({ env, cwd: resolvedCwd, sharedRoot, runtimeDir, coBrowserRoot });
  const profiles = resolvePersistentBrowserProfiles({
    rootDir,
    sourceProfileDir,
    runProfileDir: env.CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR ?? path.join(runtimeDir, "chatgpt-web-run-profile-headed"),
    runName: "chatgpt-web-run-profile-headed"
  });
  return {
    rootDir: profiles.rootDir,
    sourceProfileDir: profiles.sourceProfileDir,
    runProfileDir: profiles.runProfileDir,
    statusFile: path.resolve(env.CHATGPT_PERSISTENT_STATUS_FILE ?? path.join(runtimeDir, "chatgpt-persistent-session.json")),
    logFile: path.resolve(env.CHATGPT_PERSISTENT_LOG_FILE ?? path.join(runtimeDir, "chatgpt-persistent-session.log")),
    url: env.CHATGPT_PERSISTENT_URL ?? DEFAULT_CHATGPT_URL,
    channel: env.CHATGPT_PLAYWRIGHT_CHANNEL ?? "chrome"
  };
}

export async function openChatGptPersistentBrowser({
  env = process.env,
  cwd = process.cwd(),
  nodePath = process.execPath,
  spawnImpl = spawn
} = {}) {
  const config = resolveChatGptPersistentBrowserConfig({ env, cwd });
  await mkdir(path.dirname(config.statusFile), { recursive: true });
  const child = spawnImpl(
    nodePath,
    [
      LAUNCHER_PATH,
      "--source-profile-dir", config.sourceProfileDir,
      "--run-profile-dir", config.runProfileDir,
      "--status-file", config.statusFile,
      "--log-file", config.logFile,
      "--url", config.url,
      "--channel", config.channel
    ],
    {
      cwd,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref?.();
  await writeJson(config.statusFile, {
    status: "launching",
    pid: child.pid,
    launchedAt: new Date().toISOString(),
    mode: "headed",
    backend: "playwright-persistent-headed",
    sourceProfileDir: config.sourceProfileDir,
    runProfileDir: config.runProfileDir,
    url: config.url
  });
  return {
    status: "launching",
    pid: child.pid,
    mode: "headed",
    backend: "playwright-persistent-headed",
    sourceProfileDir: config.sourceProfileDir,
    runProfileDir: config.runProfileDir,
    statusFile: config.statusFile,
    url: config.url
  };
}

export async function readChatGptPersistentBrowserStatus({
  env = process.env,
  cwd = process.cwd(),
  isProcessRunning = defaultIsProcessRunning
} = {}) {
  const config = resolveChatGptPersistentBrowserConfig({ env, cwd });
  try {
    const status = JSON.parse(await readFile(config.statusFile, "utf8"));
    if (
      (status.status === "ready" || status.status === "launching") &&
      status.pid &&
      !isProcessRunning(Number(status.pid))
    ) {
      return {
        ...status,
        status: "stopped",
        previousStatus: status.status,
        sourceProfileDir: config.sourceProfileDir,
        runProfileDir: config.runProfileDir,
        statusFile: config.statusFile,
        url: config.url
      };
    }
    return status;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        status: "not_started",
        backend: "playwright-persistent-headed",
        sourceProfileDir: config.sourceProfileDir,
        runProfileDir: config.runProfileDir,
        statusFile: config.statusFile,
        url: config.url
      };
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function resolveSourceProfileDir({ env, cwd, sharedRoot, runtimeDir, coBrowserRoot }) {
  if (env.TIKTOK_SHARED_SOURCE_PROFILE_DIR) {
    return path.resolve(env.TIKTOK_SHARED_SOURCE_PROFILE_DIR);
  }

  const candidates = [
    path.join(coBrowserRoot, "source-profile"),
    path.join(sharedRoot, "shared-source-profile"),
    path.join(cwd, "..", "TikTok Project Monitor", ".runtime", "browser", "tiktok-monitor-profile-headed"),
    path.join(runtimeDir, "shared-source-profile"),
    path.join(runtimeDir, "tiktok-monitor-profile-headed")
  ];

  return firstExistingPath(candidates) ?? candidates[0];
}

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCoBrowserRoot(env = process.env) {
  return path.resolve(env.COBROWSER_HOME ?? path.join(os.homedir(), ".codex-cobrowser"));
}

function defaultIsProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
