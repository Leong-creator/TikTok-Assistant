import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultPersistentBrowserRoot, resolvePersistentBrowserProfiles } from "./persistent-browser-runtime.mjs";

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const LAUNCHER_PATH = fileURLToPath(new URL("./chatgpt-persistent-browser-launcher.mjs", import.meta.url));

export function resolveChatGptPersistentBrowserConfig({
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const sharedRoot = env.TIKTOK_PERSISTENT_BROWSER_ROOT_DIR ?? defaultPersistentBrowserRoot();
  const profiles = resolvePersistentBrowserProfiles({
    rootDir: sharedRoot,
    sourceProfileDir: env.TIKTOK_SHARED_SOURCE_PROFILE_DIR,
    runProfileDir: env.CHATGPT_PLAYWRIGHT_RUN_PROFILE_DIR,
    runName: "chatgpt-web-run-profile-headed"
  });
  const runtimeDir = path.resolve(cwd, ".runtime", "browser");
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
  cwd = process.cwd()
} = {}) {
  const config = resolveChatGptPersistentBrowserConfig({ env, cwd });
  try {
    return JSON.parse(await readFile(config.statusFile, "utf8"));
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
