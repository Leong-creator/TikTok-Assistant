import fs from "node:fs/promises";
import path from "node:path";
import { isSubPath, resolvePaths, sanitizeName } from "./paths.mjs";

const EXCLUDED_NAMES = new Set([
  "browsermetrics",
  "cache",
  "code cache",
  "crashpad",
  "dawncache",
  "gpucache",
  "grshadercache",
  "lockfile",
  "safebrowsing",
  "shadercache",
  "singletoncookie",
  "singletonlock",
  "singletonsocket"
]);

const EXCLUDED_SUFFIXES = [
  ".lock",
  ".tmp"
];

export async function ensureStateDirs(root) {
  const paths = resolvePaths(root);
  await Promise.all([
    fs.mkdir(paths.sourceProfileDir, { recursive: true }),
    fs.mkdir(paths.runProfilesDir, { recursive: true }),
    fs.mkdir(paths.downloadsDir, { recursive: true }),
    fs.mkdir(paths.screenshotsDir, { recursive: true }),
    fs.mkdir(paths.logsDir, { recursive: true })
  ]);
  return paths;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function directoryHasEntries(target) {
  try {
    const entries = await fs.readdir(target);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export function shouldCopyProfilePath(sourcePath, sourceRoot) {
  if (path.resolve(sourcePath) === path.resolve(sourceRoot)) {
    return true;
  }

  const name = path.basename(sourcePath).toLowerCase();
  if (EXCLUDED_NAMES.has(name)) {
    return false;
  }

  if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    return false;
  }

  const relative = path.relative(sourceRoot, sourcePath).toLowerCase();
  const segments = relative.split(path.sep);
  return !segments.some((segment) => EXCLUDED_NAMES.has(segment));
}

export async function copyProfile(sourceDir, targetDir) {
  if (!(await pathExists(sourceDir)) || !(await directoryHasEntries(sourceDir))) {
    await fs.mkdir(targetDir, { recursive: true });
    return { copied: false, reason: "source-profile-empty" };
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => shouldCopyProfilePath(sourcePath, sourceDir)
  });

  return { copied: true, reason: "copied-source-profile" };
}

export async function prepareRunProfile({
  mode = "headless",
  profile,
  fresh = false,
  root
} = {}) {
  const paths = await ensureStateDirs(root);
  const ephemeral = !profile;
  const profileName = ephemeral
    ? sanitizeName(`${mode}-task-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
    : sanitizeName(`${mode}-${profile}`);
  const runProfileDir = path.join(paths.runProfilesDir, profileName);

  if (fresh || !(await pathExists(runProfileDir))) {
    const seed = await copyProfile(paths.sourceProfileDir, runProfileDir);
    return { paths, profileDir: runProfileDir, profileName, seed, ephemeral };
  }

  return {
    paths,
    profileDir: runProfileDir,
    profileName,
    seed: { copied: false, reason: "existing-run-profile" },
    ephemeral
  };
}

export async function prepareSourceProfile({ root } = {}) {
  const paths = await ensureStateDirs(root);
  await fs.mkdir(paths.sourceProfileDir, { recursive: true });
  return { paths, profileDir: paths.sourceProfileDir, profileName: "source-profile" };
}

export async function resetRunProfiles({ root } = {}) {
  const paths = await ensureStateDirs(root);
  if (!isSubPath(paths.runProfilesDir, paths.root)) {
    throw new Error(`Refusing to delete outside CoBrowser state root: ${paths.runProfilesDir}`);
  }
  await fs.rm(paths.runProfilesDir, { recursive: true, force: true });
  await fs.mkdir(paths.runProfilesDir, { recursive: true });
  return { reset: true, runProfilesDir: paths.runProfilesDir };
}
