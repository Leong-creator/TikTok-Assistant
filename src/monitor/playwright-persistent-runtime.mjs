import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createPlaywrightLaunchOptions({ headless = true, channel = "chrome" } = {}) {
  return createPersistentChromeLaunchOptions({ headless, channel, acceptDownloads: false });
}

export function defaultPersistentBrowserRoot({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, ".codex", "persistent-browser-profiles");
}

export function resolvePersistentBrowserProfiles({
  rootDir = defaultPersistentBrowserRoot(),
  sourceProfileDir,
  runProfileDir,
  sourceName = "shared-source-profile",
  runName = "tiktok-monitor-run-profile-headless"
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  return {
    rootDir: resolvedRoot,
    sourceProfileDir: path.resolve(sourceProfileDir ?? path.join(resolvedRoot, sourceName)),
    runProfileDir: path.resolve(runProfileDir ?? path.join(resolvedRoot, runName))
  };
}

export function createPersistentChromeLaunchOptions({
  headless = true,
  channel = "chrome",
  acceptDownloads = false,
  width = 1440,
  height = 960
} = {}) {
  return {
    channel,
    headless,
    acceptDownloads,
    viewport: { width, height },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      `--window-size=${width},${height}`
    ]
  };
}

export function createHeadlessTikTokLaunchOptions(overrides = {}) {
  return createPersistentChromeLaunchOptions({
    headless: true,
    acceptDownloads: false,
    ...overrides
  });
}

export function createHeadedChatGptLaunchOptions(overrides = {}) {
  return createPersistentChromeLaunchOptions({
    headless: false,
    acceptDownloads: true,
    ...overrides
  });
}

export function ensureSeededProfile({ profileDir, seedProfileDir, sourceProfileDir } = {}) {
  const targetDir = path.resolve(profileDir ?? "");
  const sourceDir = resolveSourceProfileDir({ seedProfileDir, sourceProfileDir });
  if (!targetDir || fs.existsSync(targetDir) || !sourceDir) {
    return false;
  }
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source profile missing: ${sourceDir}`);
  }
  const tmpDir = `${targetDir}.seed-${Date.now()}`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  copyDirBestEffort(sourceDir, tmpDir);
  fs.renameSync(tmpDir, targetDir);
  return true;
}

export async function startPlaywrightPersistentContext({
  playwright,
  profileDir,
  seedProfileDir,
  sourceProfileDir,
  headless = true,
  channel = "chrome",
  acceptDownloads = false
} = {}) {
  ensureSeededProfile({ profileDir, seedProfileDir, sourceProfileDir });
  return playwright.chromium.launchPersistentContext(
    path.resolve(profileDir),
    createPersistentChromeLaunchOptions({ headless, channel, acceptDownloads })
  );
}

function resolveSourceProfileDir({ seedProfileDir, sourceProfileDir } = {}) {
  const source = sourceProfileDir ?? seedProfileDir;
  return source ? path.resolve(source) : "";
}

function shouldSkipProfileEntry(name) {
  return /^(Singleton|lockfile$|lock$|DevToolsActivePort$)/i.test(name) ||
    /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics)$/i.test(name);
}

function copyDirBestEffort(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldSkipProfileEntry(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    try {
      if (entry.isDirectory()) copyDirBestEffort(from, to);
      else if (entry.isFile()) fs.copyFileSync(from, to);
    } catch {
      // Busy profile-adjacent files are copied best effort to match the OpenClaw runtime behavior.
    }
  }
}
