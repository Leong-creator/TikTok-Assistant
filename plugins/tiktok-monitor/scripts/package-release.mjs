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
await fs.writeFile(path.join(packageDir, "install.cmd"), buildWindowsBootstrapScript(), "utf8");
await fs.writeFile(path.join(packageDir, "install.sh"), buildPosixInstallerScript(), { encoding: "utf8", mode: 0o755 });
await fs.writeFile(path.join(packageDir, "INSTALL.md"), buildInstallGuide(version), "utf8");
await fs.writeFile(path.join(packageDir, "release.json"), `${JSON.stringify(buildReleaseManifest(version), null, 2)}\n`, "utf8");

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
$LauncherCmd = Join-Path $env:APPDATA 'npm\\tiktok-monitor.cmd'
$LauncherPs1 = Join-Path $env:APPDATA 'npm\\tiktok-monitor.ps1'
$LauncherScript = Join-Path $PluginTarget 'scripts\\tiktok-monitor-launcher.mjs'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginTarget) | Out-Null
if (Test-Path $PluginTarget) { Remove-Item -Recurse -Force $PluginTarget }
Copy-Item -Recurse -Force $PluginSource $PluginTarget
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginCache) | Out-Null
if (Test-Path $PluginCache) { Remove-Item -Recurse -Force $PluginCache }
Copy-Item -Recurse -Force $PluginSource $PluginCache

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LauncherCmd) | Out-Null
@"
@echo off
setlocal
node "$LauncherScript" %*
"@ | Set-Content -Encoding ASCII $LauncherCmd

@"
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error '未检测到 Node.js，请先安装 Node.js 后再运行 tiktok-monitor。'
}
& node '$LauncherScript' @args
"@ | Set-Content -Encoding UTF8 $LauncherPs1

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
Write-Host "Launcher: $LauncherCmd"
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

function buildWindowsBootstrapScript() {
  return [
    "@echo off",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0install.ps1\""
  ].join("\r\n");
}

function buildPosixInstallerScript() {
  return `#!/usr/bin/env sh
set -eu

PACKAGE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_SOURCE="$PACKAGE_ROOT/plugins/tiktok-monitor"
PLUGIN_TARGET="$HOME/plugins/tiktok-monitor"
CACHE_TARGET="$HOME/.codex/plugins/cache/local-codex-plugins/tiktok-monitor/${version}"
BIN_DIR="\${XDG_BIN_HOME:-$HOME/.local/bin}"
LAUNCHER="$BIN_DIR/tiktok-monitor"
LAUNCHER_SCRIPT="$PLUGIN_TARGET/scripts/tiktok-monitor-launcher.mjs"

mkdir -p "$(dirname "$PLUGIN_TARGET")" "$(dirname "$CACHE_TARGET")" "$BIN_DIR"
rm -rf "$PLUGIN_TARGET" "$CACHE_TARGET"
cp -R "$PLUGIN_SOURCE" "$PLUGIN_TARGET"
cp -R "$PLUGIN_SOURCE" "$CACHE_TARGET"

printf '%s\n' '#!/usr/bin/env sh' "exec node '$LAUNCHER_SCRIPT' \"\$@\"" > "$LAUNCHER"
chmod +x "$LAUNCHER"

echo "TikTok monitor installed."
echo "Plugin: $PLUGIN_TARGET"
echo "Cache: $CACHE_TARGET"
echo "Launcher: $LAUNCHER"
echo "如果缺少 CloakBrowser 登录态或 Base 配置，首次运行 tiktok-monitor cycle 时会给出中文引导。"

if command -v node >/dev/null 2>&1; then
  echo "正在自动执行 TikTok monitor 初始化检查..."
  node "$PLUGIN_TARGET/scripts/setup.mjs"
else
  echo "未检测到 Node.js，请先安装 Node.js 后手动运行："
  echo "node \"$PLUGIN_TARGET/scripts/setup.mjs\""
fi
`;
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
2. Run \`install.cmd\` or \`install.ps1\` on Windows, or \`./install.sh\` on macOS/Linux.
3. The installer auto-runs \`setup.mjs\` when Node.js is available.
4. If setup reports manual steps, complete them in the generated Chinese guidance.
5. After install, external agents can call the global launcher command directly.

## First run

\`\`\`powershell
tiktok-monitor setup
tiktok-monitor cycle
\`\`\`

## External agent entry

- Preferred:
  - \`tiktok-monitor cycle\`
  - \`tiktok-monitor cycle --background\`
  - \`tiktok-monitor status\`
  - \`tiktok-monitor sync\`
- Fallback:
  - \`node "$HOME/plugins/tiktok-monitor/scripts/tiktok-monitor-launcher.mjs" cycle\`
`;
}

function buildReleaseManifest(versionText) {
  return {
    plugin: "tiktok-monitor",
    version: versionText,
    install: {
      windows: ["install.cmd", "install.ps1"],
      posix: ["install.sh"]
    },
    launchers: [
      "tiktok-monitor cycle",
      "tiktok-monitor cycle --background",
      "tiktok-monitor status",
      "tiktok-monitor sync",
      "tiktok-monitor setup"
    ],
    notesCn: [
      "安装器会尽量自动完成可封装步骤。",
      "TikTok 登录、CloakBrowser 安装和真实 Base 配置仍需要用户或 agent 按中文提示完成。"
    ]
  };
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
