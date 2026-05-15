import os from "node:os";
import path from "node:path";

export function stateRoot() {
  return path.resolve(process.env.COBROWSER_HOME || path.join(os.homedir(), ".codex-cobrowser"));
}

export function pluginRoot() {
  return path.resolve(path.join(import.meta.dirname, ".."));
}

export function resolvePaths(root = stateRoot()) {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    sourceProfileDir: path.join(resolvedRoot, "source-profile"),
    runProfilesDir: path.join(resolvedRoot, "run-profiles"),
    downloadsDir: path.join(resolvedRoot, "downloads"),
    screenshotsDir: path.join(resolvedRoot, "screenshots"),
    logsDir: path.join(resolvedRoot, "logs")
  };
}

export function sanitizeName(value, fallback = "default") {
  const safe = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return safe || fallback;
}

export function isSubPath(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
