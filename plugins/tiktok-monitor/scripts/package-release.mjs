#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const repoRoot = path.resolve(path.join(pluginRoot, "..", ".."));
const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const version = manifest.version || "0.1.0";
const releaseRoot = path.join(repoRoot, "dist", "plugin-releases");
const packageDir = path.join(releaseRoot, `tiktok-monitor-${version}`);
const zipPath = path.join(releaseRoot, `tiktok-monitor-${version}.zip`);
const buildScriptPath = path.join(scriptDir, "build-bundle.mjs");

await runNodeScript(buildScriptPath);
await fs.rm(packageDir, { recursive: true, force: true });
await fs.rm(zipPath, { force: true });
await fs.mkdir(path.join(packageDir, "plugins"), { recursive: true });
await fs.mkdir(path.join(packageDir, ".agents", "plugins"), { recursive: true });

await fs.cp(pluginRoot, path.join(packageDir, "plugins", "tiktok-monitor"), {
  recursive: true,
  force: true
});
await fs.writeFile(
  path.join(packageDir, ".agents", "plugins", "marketplace.json"),
  `${JSON.stringify(buildPackageMarketplace(), null, 2)}\n`,
  "utf8"
);
await fs.writeFile(path.join(packageDir, "install.ps1"), buildInstallerScript(), "utf8");
await fs.writeFile(path.join(packageDir, "INSTALL.md"), buildInstallGuide(version), "utf8");

await runPowerShell([
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path '${escapeForPs(path.join(packageDir, '*'))}' -DestinationPath '${escapeForPs(zipPath)}' -Force`
]);

console.log(JSON.stringify({
  plugin: "tiktok-monitor",
  version,
  packageDir,
  zipPath
}, null, 2));

function buildInstallerScript() {
  return `
$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginSource = Join-Path $PackageRoot 'plugins\\tiktok-monitor'
$PluginTarget = Join-Path $HOME 'plugins\\tiktok-monitor'
$PluginCache = Join-Path $HOME '.codex\\plugins\\cache\\local-codex-plugins\\tiktok-monitor\\${version}'
$MarketplaceTarget = Join-Path $HOME '.agents\\plugins\\marketplace.json'
$CodexConfig = Join-Path $HOME '.codex\\config.toml'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginTarget) | Out-Null
if (Test-Path $PluginTarget) { Remove-Item -Recurse -Force $PluginTarget }
Copy-Item -Recurse -Force $PluginSource $PluginTarget
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginCache) | Out-Null
if (Test-Path $PluginCache) { Remove-Item -Recurse -Force $PluginCache }
Copy-Item -Recurse -Force $PluginSource $PluginCache

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MarketplaceTarget) | Out-Null
$marketplace = if (Test-Path $MarketplaceTarget) {
  Get-Content $MarketplaceTarget -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{
    name = 'local-codex-plugins'
    interface = [pscustomobject]@{ displayName = 'Local Codex Plugins' }
    plugins = @()
  }
}

$entry = [pscustomobject]@{
  name = 'tiktok-monitor'
  source = [pscustomobject]@{ source = 'local'; path = './plugins/tiktok-monitor' }
  policy = [pscustomobject]@{ installation = 'AVAILABLE'; authentication = 'ON_INSTALL' }
  category = 'Engineering'
}

$plugins = @($marketplace.plugins)
$existing = $plugins | Where-Object { $_.name -eq 'tiktok-monitor' }
if ($existing) {
  $plugins = @($plugins | Where-Object { $_.name -ne 'tiktok-monitor' })
}
$plugins += $entry
$marketplace.plugins = $plugins
$marketplace | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $MarketplaceTarget

if (-not (Test-Path $CodexConfig)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CodexConfig) | Out-Null
  '' | Set-Content -Encoding UTF8 $CodexConfig
}
$configText = Get-Content $CodexConfig -Raw
$section = "[plugins.""tiktok-monitor@local-codex-plugins""]"
if ($configText -notmatch [regex]::Escape($section)) {
  if ($configText.Length -gt 0 -and -not $configText.EndsWith("\`n")) {
    $configText += "\`n"
  }
  $configText += "$section\`nenabled = true\`n"
  Set-Content -Encoding UTF8 $CodexConfig $configText
}

Write-Host 'TikTok monitor installed.'
Write-Host "Plugin: $PluginTarget"
Write-Host "Cache: $PluginCache"
Write-Host "Marketplace: $MarketplaceTarget"
Write-Host "Codex config: $CodexConfig"

$SetupScript = Join-Path $PluginTarget 'scripts\\setup.mjs'
if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host '正在自动执行 TikTok monitor 初始化检查...'
  & node $SetupScript
  if ($LASTEXITCODE -ne 0) {
    throw "TikTok monitor 初始化检查失败，退出码: $LASTEXITCODE"
  }
} else {
  Write-Host '未检测到 Node.js，请先安装 Node.js 后手动运行以下命令：'
  Write-Host "node $SetupScript"
}
`.trimStart();
}

function buildPackageMarketplace() {
  return {
    name: "tiktok-monitor-local-marketplace",
    interface: {
      displayName: "TikTok Monitor Plugin"
    },
    plugins: [
      {
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
      }
    ]
  };
}

function buildInstallGuide(versionText) {
  return `# TikTok monitor ${versionText}

## One-click local install

1. Unzip this package.
2. Run \`install.ps1\`.
3. The installer auto-runs \`setup.mjs\` when Node.js is available.
4. If setup reports manual steps, complete them in the generated Chinese guidance.

## First run

\`\`\`powershell
node "$HOME\\plugins\\tiktok-monitor\\scripts\\tiktok-monitor.mjs" cycle
\`\`\`
`;
}

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

async function runPowerShell(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("powershell", args, {
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`powershell failed (${code ?? "unknown"})`));
    });
    child.on("error", reject);
  });
}

function escapeForPs(input) {
  return input.replace(/'/g, "''");
}
