import os from "node:os";
import path from "node:path";

export function resolveLauncherInstallTargets({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir()
} = {}) {
  if (platform === "win32") {
    const appDataDir = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    const binDir = path.join(appDataDir, "npm");
    return {
      binDir,
      commandPath: path.join(binDir, "tiktok-monitor.cmd"),
      powerShellPath: path.join(binDir, "tiktok-monitor.ps1"),
      pathHint: `请确认 ${binDir} 已在 PATH 中`
    };
  }

  const binDir = path.join(homeDir, ".local", "bin");
  return {
    binDir,
    commandPath: path.join(binDir, "tiktok-monitor"),
    pathHint: `请确认 ${binDir} 已在 PATH 中`
  };
}

export function buildWindowsCmdLauncher(scriptPath) {
  return [
    "@echo off",
    "setlocal",
    `node "${escapeCmdDoubleQuotes(scriptPath)}" %*`
  ].join("\r\n");
}

export function buildWindowsPowerShellLauncher(scriptPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$ScriptPath = '${escapePowerShellSingleQuotes(scriptPath)}'`,
    "if (-not (Get-Command node -ErrorAction SilentlyContinue)) {",
    "  Write-Error '未检测到 Node.js，请先安装 Node.js 后再运行 tiktok-monitor。'",
    "}",
    "& node $ScriptPath @args"
  ].join("\r\n");
}

export function buildPosixLauncher(scriptPath) {
  return [
    "#!/usr/bin/env sh",
    `exec node '${escapePosixSingleQuotes(scriptPath)}' "$@"`
  ].join("\n");
}

function escapeCmdDoubleQuotes(input) {
  return String(input ?? "").replace(/"/g, "\"\"");
}

function escapePowerShellSingleQuotes(input) {
  return String(input ?? "").replace(/'/g, "''");
}

function escapePosixSingleQuotes(input) {
  return String(input ?? "").replace(/'/g, "'\"'\"'");
}
