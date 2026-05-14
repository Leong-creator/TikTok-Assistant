#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const targetRoot = path.join(os.homedir(), "plugins", "tiktok-monitor");

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetRoot), { recursive: true });
await fs.cp(pluginRoot, targetRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  installed: true,
  source: pluginRoot,
  target: targetRoot
}, null, 2));
