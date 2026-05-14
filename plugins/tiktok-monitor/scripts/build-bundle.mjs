#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const repoRoot = path.resolve(path.join(pluginRoot, "..", ".."));
const distRuntimeRoot = path.join(pluginRoot, "dist", "runtime");
const tempRuntimeRoot = path.join(pluginRoot, "dist", "runtime.tmp");

await fs.rm(tempRuntimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await fs.mkdir(path.join(tempRuntimeRoot, "monitor"), { recursive: true });
await copyFile(path.join(repoRoot, "src", "monitor-cli.mjs"), path.join(tempRuntimeRoot, "monitor-cli.mjs"));
await copyTree(path.join(repoRoot, "src", "monitor"), path.join(tempRuntimeRoot, "monitor"));
await fs.rm(distRuntimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await fs.rename(tempRuntimeRoot, distRuntimeRoot);

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  built: true,
  repoRoot,
  distRuntimeRoot
}, null, 2));

async function copyTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function copyFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}
