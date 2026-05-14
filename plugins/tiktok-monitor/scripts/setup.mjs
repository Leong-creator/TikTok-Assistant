#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");

const repoRoot = resolveMonitorRepoRoot(process.env.TIKTOK_MONITOR_REPO);
const configuredDataDir = process.env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data";
const dataDir = path.isAbsolute(configuredDataDir)
  ? configuredDataDir
  : path.join(repoRoot, configuredDataDir);
const cobrowserSourceProfile = path.join(
  process.env.COBROWSER_ROOT_DIR ?? path.join(os.homedir(), ".codex-cobrowser"),
  "source-profile"
);

const checks = [
  {
    name: "bundledRuntime",
    ok: fs.existsSync(bundledCliPath),
    detail: bundledCliPath
  },
  {
    name: "monitorRepo",
    ok: fs.existsSync(path.join(repoRoot, "src", "monitor-cli.mjs")),
    detail: repoRoot
  },
  {
    name: "cobrowserSourceProfile",
    ok: fs.existsSync(cobrowserSourceProfile),
    detail: cobrowserSourceProfile
  },
  {
    name: "alertConfig",
    ok: fs.existsSync(path.join(dataDir, "alert_config.json")),
    detail: path.join(dataDir, "alert_config.json")
  },
  {
    name: "baseDashboardConfig",
    ok: fs.existsSync(path.join(dataDir, "base_dashboard_config.json")),
    detail: path.join(dataDir, "base_dashboard_config.json")
  }
];

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  developer: "Leong",
  repoRoot,
  dataDir,
  checks,
  nextSteps: [
    "If bundledRuntime is missing, run node scripts/build-bundle.mjs before publishing or installing the plugin elsewhere.",
    "If cobrowserSourceProfile is missing or empty, open CoBrowser headed and log in to TikTok once.",
    "If alertConfig is missing, create monitoring_data/alert_config.json with {\"dmOpenId\":\"<your_open_id>\"}.",
    "If baseDashboardConfig is missing, copy the example template into monitoring_data and fill in the real table IDs.",
    "For local installation, run node scripts/install-local.mjs after the bundle is built."
  ]
}, null, 2));

function resolveMonitorRepoRoot(explicitRoot) {
  const candidates = [];
  if (explicitRoot) candidates.push(explicitRoot);

  let current = path.resolve(process.cwd());
  for (let index = 0; index < 6; index += 1) {
    candidates.push(current);
    candidates.push(path.join(current, "TikTok Project Monitor"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, "src", "monitor-cli.mjs"))) {
      return root;
    }
  }

  return path.resolve(process.cwd());
}
