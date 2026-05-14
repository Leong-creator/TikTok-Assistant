#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const homeRoot = os.homedir();
const targetRoot = path.join(homeRoot, "plugins", "tiktok-monitor");
const homeMarketplacePath = path.join(homeRoot, ".agents", "plugins", "marketplace.json");
const buildScriptPath = path.join(scriptDir, "build-bundle.mjs");
const args = new Set(process.argv.slice(2));

if (!args.has("--skip-build")) {
  await runNodeScript(buildScriptPath);
}

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetRoot), { recursive: true });
await fs.cp(pluginRoot, targetRoot, { recursive: true, force: true });

const marketplace = await readOrCreateMarketplace(homeMarketplacePath);
upsertPluginEntry(marketplace);
await fs.mkdir(path.dirname(homeMarketplacePath), { recursive: true });
await fs.writeFile(homeMarketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  installed: true,
  builtBundle: !args.has("--skip-build"),
  source: pluginRoot,
  target: targetRoot,
  marketplace: homeMarketplacePath
}, null, 2));

async function runNodeScript(scriptPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit"
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
