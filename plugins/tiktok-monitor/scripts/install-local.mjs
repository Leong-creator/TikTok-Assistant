#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildPosixLauncher,
  buildWindowsCmdLauncher,
  buildWindowsPowerShellLauncher,
  resolveLauncherInstallTargets
} from "./install-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const homeRoot = os.homedir();
const targetRoot = path.join(homeRoot, "plugins", "tiktok-monitor");
const homeMarketplacePath = path.join(homeRoot, ".agents", "plugins", "marketplace.json");
const codexConfigPath = path.join(homeRoot, ".codex", "config.toml");
const buildScriptPath = path.join(scriptDir, "build-bundle.mjs");
const args = new Set(process.argv.slice(2));
const shouldRunSetup = !args.has("--skip-setup");
const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const version = manifest.version || "0.1.0";
const cacheRoot = path.join(homeRoot, ".codex", "plugins", "cache", "local-codex-plugins", "tiktok-monitor", version);
const launcherScriptPath = path.join(targetRoot, "scripts", "tiktok-monitor-launcher.mjs");

if (!args.has("--skip-build")) {
  await runNodeScript(buildScriptPath);
}

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetRoot), { recursive: true });
await fs.cp(pluginRoot, targetRoot, { recursive: true, force: true });
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(cacheRoot), { recursive: true });
await fs.cp(pluginRoot, cacheRoot, { recursive: true, force: true });
const launcherInfo = await installLaunchers({
  platform: process.platform,
  homeRoot,
  launcherScriptPath
});

const marketplace = await readOrCreateMarketplace(homeMarketplacePath);
upsertPluginEntry(marketplace);
await fs.mkdir(path.dirname(homeMarketplacePath), { recursive: true });
await fs.writeFile(homeMarketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
await enablePluginInCodexConfig(codexConfigPath);

if (shouldRunSetup) {
  await runNodeScript(path.join(targetRoot, "scripts", "setup.mjs"), [], { cwd: targetRoot });
}

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  installed: true,
  builtBundle: !args.has("--skip-build"),
  setupRan: shouldRunSetup,
  version,
  source: pluginRoot,
  target: targetRoot,
  cache: cacheRoot,
  launcher: launcherInfo,
  marketplace: homeMarketplacePath,
  codexConfig: codexConfigPath
}, null, 2));

async function runNodeScript(scriptPath, args = [], options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd ?? process.cwd(),
      stdio: "inherit",
      windowsHide: true
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`script failed: ${scriptPath} (${code ?? "unknown"})`));
    });
    child.on("error", reject);
  });
}

async function installLaunchers({ platform, homeRoot, launcherScriptPath }) {
  const targets = resolveLauncherInstallTargets({
    platform,
    env: process.env,
    homeDir: homeRoot
  });
  await fs.mkdir(targets.binDir, { recursive: true });

  if (platform === "win32") {
    await fs.writeFile(targets.commandPath, `${buildWindowsCmdLauncher(launcherScriptPath)}\r\n`, "utf8");
    await fs.writeFile(targets.powerShellPath, `${buildWindowsPowerShellLauncher(launcherScriptPath)}\r\n`, "utf8");
    return {
      binDir: targets.binDir,
      commandPath: targets.commandPath,
      powerShellPath: targets.powerShellPath,
      pathHint: targets.pathHint
    };
  }

  await fs.writeFile(targets.commandPath, `${buildPosixLauncher(launcherScriptPath)}\n`, {
    encoding: "utf8",
    mode: 0o755
  });
  return {
    binDir: targets.binDir,
    commandPath: targets.commandPath,
    pathHint: targets.pathHint
  };
}

async function readOrCreateMarketplace(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
    return {
      name: "local-codex-plugins",
      interface: {
        displayName: "Local Codex Plugins"
      },
      plugins: []
    };
  }
}

function upsertPluginEntry(marketplace) {
  const entry = {
    name: "tiktok-monitor",
    source: {
      source: "local",
      path: "./plugins/tiktok-monitor"
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Engineering"
  };
  if (!Array.isArray(marketplace.plugins)) {
    marketplace.plugins = [];
  }
  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === entry.name);
  if (existingIndex >= 0) {
    marketplace.plugins[existingIndex] = entry;
    return;
  }
  marketplace.plugins.push(entry);
}

async function enablePluginInCodexConfig(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
  const sectionHeader = '[plugins."tiktok-monitor@local-codex-plugins"]';
  if (content.includes(sectionHeader)) {
    return;
  }
  const block = `${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${sectionHeader}\nenabled = true\n`;
  await fs.writeFile(filePath, `${content}${block}`, "utf8");
}
