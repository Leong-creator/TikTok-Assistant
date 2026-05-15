#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { browserSupervisionPolicySummary } from "../src/browser-supervision-policy.mjs";

const execFileAsync = promisify(execFile);

const chromePluginRoot = path.join(
  os.homedir(),
  ".codex",
  "plugins",
  "cache",
  "openai-bundled",
  "chrome",
  "latest"
);

if (!existsSync(chromePluginRoot)) {
  throw new Error(`Chrome plugin root not found: ${chromePluginRoot}`);
}

const checks = [
  ["chrome-is-running", ["scripts/chrome-is-running.js", "--json"]],
  ["installed-browsers", ["scripts/installed-browsers.js", "--json"]],
  ["extension-installed", ["scripts/check-extension-installed.js", "--json"]],
  ["native-host-manifest", ["scripts/check-native-host-manifest.js", "--json"]]
];

const clearedHosts = await clearCodexChromeHosts();
const restartedHost = clearedHosts.length > 0 ? await waitForCodexChromeHost(15000) : await getCodexChromeHosts();
const registryRepair = await ensureNativeHostRegistry();
if (clearedHosts.length > 0) {
  await sleep(1500);
}

const results = [];
for (const [name, args] of checks) {
  const attempts = name === "native-host-manifest" ? 3 : 1;
  const result = await runCheck(args, attempts);
  const normalizedResult =
    name === "native-host-manifest" && result.exitCode !== 0
      ? await normalizeNativeHostCheck(result)
      : result;
  results.push({
    name,
    attempts: normalizedResult.attempts,
    exitCode: normalizedResult.exitCode,
    ok: normalizedResult.exitCode === 0,
    output: parseMaybeJson(normalizedResult.stdout) ?? normalizedResult.stdout.trim()
  });
}

process.stdout.write(
  JSON.stringify(
    {
      chromePluginRoot,
      checks: results,
      clearedHosts,
      restartedHost,
      registryRepair,
      browserSupervisionPolicy: browserSupervisionPolicySummary()
    },
    null,
    2
  ) + "\n"
);
if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

async function ensureNativeHostRegistry() {
  if (process.platform !== "win32") return { skipped: true, reason: "not-windows" };
  const hostName = "com.openai.codexextension";
  const manifestPath = path.join(os.homedir(), "AppData", "Local", "OpenAI", "extension", `${hostName}.json`);
  if (!existsSync(manifestPath)) {
    return { ok: false, manifestPath, problem: "manifest-not-found" };
  }

  const registryKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
  const result = await run(
    "reg",
    ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { allowFailure: true }
  );
  return {
    ok: result.exitCode === 0,
    registryKey,
    manifestPath,
    exitCode: result.exitCode,
    output: result.stdout.trim() || result.stderr.trim()
  };
}

async function waitForCodexChromeHost(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hosts = await getCodexChromeHosts();
    if (hosts.length > 0) return hosts;
    await sleep(500);
  }
  return [];
}

async function getCodexChromeHosts() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$hosts = Get-Process extension-host | Where-Object { $_.Path -like '*\\.codex\\plugins\\cache\\openai-bundled\\chrome\\*' }",
    "$items = @()",
    "foreach ($hostProcess in $hosts) {",
    "  $items += [pscustomobject]@{ Id = $hostProcess.Id; Path = $hostProcess.Path; StartTime = $hostProcess.StartTime }",
    "}",
    "$items | ConvertTo-Json -Depth 4"
  ].join("; ");
  const result = await run("powershell", ["-NoProfile", "-Command", script], { allowFailure: true });
  if (!result.stdout.trim()) return [];
  const parsed = parseMaybeJson(result.stdout);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

async function runCheck(args, maxAttempts) {
  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await run("node", args, { cwd: chromePluginRoot, allowFailure: true });
    if (lastResult.exitCode === 0) {
      return { ...lastResult, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await sleep(1000);
    }
  }
  return { ...lastResult, attempts: maxAttempts };
}

async function normalizeNativeHostCheck(officialResult) {
  const fallback = await checkNativeHostRegistryAndManifest();
  if (!fallback.correct) return officialResult;
  return {
    ...officialResult,
    exitCode: 0,
    stdout: JSON.stringify({
      ...fallback,
      officialCheckFallback: true,
      officialOutput: parseMaybeJson(officialResult.stdout) ?? officialResult.stdout.trim()
    })
  };
}

async function checkNativeHostRegistryAndManifest() {
  const hostName = "com.openai.codexextension";
  const extensionId = "hehggadaopoacecdllhhajmbjkdcmajg";
  const registryKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
  const manifestPath = path.join(os.homedir(), "AppData", "Local", "OpenAI", "extension", `${hostName}.json`);
  const expectedOrigin = `chrome-extension://${extensionId}/`;
  const registry = await run("reg", ["query", registryKey, "/ve"], { allowFailure: true });
  const registryMatchesManifestPath = registry.exitCode === 0 && registry.stdout.includes(manifestPath);
  const exists = existsSync(manifestPath);
  if (!exists) {
    return { correct: false, registryKey, manifestPath, exists, problem: "manifest-not-found" };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const allowedOrigins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  const nameMatches = manifest.name === hostName;
  const hasExpectedOrigin = allowedOrigins.includes(expectedOrigin);
  const correct = registryMatchesManifestPath && nameMatches && hasExpectedOrigin;
  return {
    registryKey,
    manifestPath,
    expectedHostName: hostName,
    actualHostName: manifest.name,
    expectedExtensionId: extensionId,
    expectedOrigin,
    allowedOrigins,
    exists,
    registryMatchesManifestPath,
    nameMatches,
    hasExpectedOrigin,
    correct,
    problem: correct ? null : "native-host registry or manifest did not match expected Chrome extension settings"
  };
}

async function clearCodexChromeHosts() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$hosts = Get-Process extension-host | Where-Object { $_.Path -like '*\\.codex\\plugins\\cache\\openai-bundled\\chrome\\*' }",
    "$items = @()",
    "foreach ($hostProcess in $hosts) {",
    "  $items += [pscustomobject]@{ Id = $hostProcess.Id; Path = $hostProcess.Path; StartTime = $hostProcess.StartTime }",
    "  Stop-Process -Id $hostProcess.Id -Force",
    "}",
    "$items | ConvertTo-Json -Depth 4"
  ].join("; ");
  const result = await run("powershell", ["-NoProfile", "-Command", script], { allowFailure: true });
  if (!result.stdout.trim()) return [];
  const parsed = parseMaybeJson(result.stdout);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

async function run(command, args, { cwd = process.cwd(), allowFailure = false } = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (!allowFailure) throw error;
    return {
      exitCode: Number(error.code ?? 1),
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message ?? error)
    };
  }
}

function parseMaybeJson(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
