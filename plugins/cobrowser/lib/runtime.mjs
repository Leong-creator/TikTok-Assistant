import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSubPath } from "./paths.mjs";
import { ensureStateDirs, prepareRunProfile, prepareSourceProfile } from "./profile-manager.mjs";

const require = createRequire(import.meta.url);

export async function loadPlaywright() {
  const candidates = [
    process.env.COBROWSER_PLAYWRIGHT_MODULE,
    "playwright",
    path.join(os.homedir(), "node_modules", "playwright")
  ].filter(Boolean);

  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(
    [
      "Unable to load Playwright.",
      "Install it where Node can resolve it, or set COBROWSER_PLAYWRIGHT_MODULE to the package path.",
      ...errors
    ].join("\n")
  );
}

export function normalizeMode(mode) {
  const value = String(mode || "headless").toLowerCase();
  if (value !== "headed" && value !== "headless") {
    throw new Error(`Invalid CoBrowser mode: ${mode}. Use "headed" or "headless".`);
  }
  return value;
}

export function launchOptions({
  mode = "headless",
  acceptDownloads = true,
  downloadsDir,
  width = 1440,
  height = 960,
  channel = process.env.COBROWSER_CHROME_CHANNEL || "chrome"
} = {}) {
  const normalizedMode = normalizeMode(mode);
  return {
    channel,
    headless: normalizedMode === "headless",
    acceptDownloads: Boolean(acceptDownloads),
    downloadsPath: downloadsDir,
    viewport: { width: Number(width), height: Number(height) },
    args: [
      "--disable-features=Translate,MediaRouter",
      "--no-default-browser-check",
      "--no-first-run"
    ]
  };
}

export async function startSession({
  mode = "headless",
  profile,
  source = false,
  fresh = false,
  acceptDownloads = true,
  width = 1440,
  height = 960,
  root
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const playwright = await loadPlaywright();
  const prepared = source
    ? await prepareSourceProfile({ root })
    : await prepareRunProfile({ mode: normalizedMode, profile, fresh, root });
  const paths = await ensureStateDirs(root);
  const context = await playwright.chromium.launchPersistentContext(
    prepared.profileDir,
    launchOptions({
      mode: normalizedMode,
      acceptDownloads,
      downloadsDir: paths.downloadsDir,
      width,
      height
    })
  );
  const page = context.pages()[0] || await context.newPage();

  return {
    playwright,
    context,
    page,
    paths,
    profileDir: prepared.profileDir,
    profileName: prepared.profileName,
    seed: prepared.seed,
    async close() {
      try {
        await context.close();
      } finally {
        if (!source && prepared.ephemeral && isSubPath(prepared.profileDir, paths.runProfilesDir)) {
          await fs.rm(prepared.profileDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  };
}

export async function withSession(options, callback) {
  const session = await startSession(options);
  try {
    return await callback(session);
  } finally {
    await session.close();
  }
}
