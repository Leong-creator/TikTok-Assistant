#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(path.join(scriptDir, ".."));
const bundledCliPath = path.join(pluginRoot, "dist", "runtime", "monitor-cli.mjs");
const buildBundleScriptPath = path.join(scriptDir, "build-bundle.mjs");
const alertTemplatePath = path.join(pluginRoot, "templates", "alert_config.example.json");
const baseDashboardTemplatePath = path.join(pluginRoot, "templates", "base_dashboard_config.example.json");
const whitelistBaseTemplatePath = path.join(pluginRoot, "templates", "base_dashboard_whitelist_config.example.json");

let runNodeScriptImpl = runNodeScript;

export function __setRunNodeScriptForTests(fn) {
  runNodeScriptImpl = fn ?? runNodeScript;
}

export async function inspectAndPrepareSetup({
  cwd = process.cwd(),
  env = process.env,
  autoFix = true
} = {}) {
  const repoRoot = resolveMonitorRepoRoot(env.TIKTOK_MONITOR_REPO, cwd);
  const configuredDataDir = env.TIKTOK_MONITOR_DATA_DIR ?? "monitoring_data";
  const dataDir = path.isAbsolute(configuredDataDir)
    ? configuredDataDir
    : path.join(repoRoot, configuredDataDir);
  const cloakbrowserHome = env.CLOAKBROWSER_HOME ?? path.join(os.homedir(), ".codex-cloakbrowser");
  const cloakbrowserSourceProfile = path.join(cloakbrowserHome, "source-profile");

  const autoActions = [];
  const manualActions = [];
  const errors = [];

  await fsp.mkdir(dataDir, { recursive: true });

  let bundledRuntimeExists = fs.existsSync(bundledCliPath);
  const repoRuntimeExists = fs.existsSync(path.join(repoRoot, "src", "monitor-cli.mjs"));

  if (!bundledRuntimeExists && autoFix && repoRuntimeExists) {
    try {
      await runNodeScriptImpl(buildBundleScriptPath, [], { cwd: pluginRoot });
      bundledRuntimeExists = fs.existsSync(bundledCliPath);
      if (bundledRuntimeExists) {
        autoActions.push({
          name: "bundledRuntime",
          statusCn: "已自动构建运行时",
          detail: bundledCliPath
        });
      } else {
        errors.push({
          name: "bundledRuntime",
          statusCn: "自动构建后仍缺少运行时",
          detail: bundledCliPath
        });
      }
    } catch (error) {
      errors.push({
        name: "bundledRuntime",
        statusCn: "自动构建运行时失败",
        detail: String(error?.message ?? error ?? "")
      });
    }
  }

  const alertConfigPath = path.join(dataDir, "alert_config.json");
  if (!fs.existsSync(alertConfigPath) && autoFix) {
    await copyTemplateIfMissing(alertTemplatePath, alertConfigPath);
    autoActions.push({
      name: "alertConfig",
      statusCn: "已自动创建告警配置模板",
      detail: alertConfigPath
    });
  }

  const baseDashboardConfigPath = path.join(dataDir, "base_dashboard_config.json");
  if (!fs.existsSync(baseDashboardConfigPath) && autoFix) {
    await copyTemplateIfMissing(baseDashboardTemplatePath, baseDashboardConfigPath);
    autoActions.push({
      name: "baseDashboardConfig",
      statusCn: "已自动创建 Base 配置模板",
      detail: baseDashboardConfigPath
    });
  }

  const whitelistBaseConfigPath = path.join(dataDir, "base_dashboard_whitelist_config.json");
  if (!fs.existsSync(whitelistBaseConfigPath) && autoFix) {
    const seededWhitelistConfig = seedWhitelistConfigFromDashboard(baseDashboardConfigPath);
    if (seededWhitelistConfig) {
      await writeJsonFile(whitelistBaseConfigPath, seededWhitelistConfig);
      autoActions.push({
        name: "whitelistBaseConfig",
        statusCn: "已自动根据现有 Base 配置生成白名单配置",
        detail: whitelistBaseConfigPath
      });
    } else {
      await copyTemplateIfMissing(whitelistBaseTemplatePath, whitelistBaseConfigPath);
      autoActions.push({
        name: "whitelistBaseConfig",
        statusCn: "已自动创建白名单 Base 配置模板",
        detail: whitelistBaseConfigPath
      });
    }
  }

  const alertConfig = readJsonFile(alertConfigPath);
  const baseDashboardConfig = readJsonFile(baseDashboardConfigPath);
  const whitelistBaseConfig = readJsonFile(whitelistBaseConfigPath);
  const sourceProfileState = inspectSourceProfile(cloakbrowserSourceProfile);

  const alertConfigReady = hasRealAlertConfig(alertConfig);
  const baseDashboardConfigReady = hasRealBaseDashboardConfig(baseDashboardConfig);
  const whitelistBaseConfigReady = hasRealWhitelistBaseConfig(whitelistBaseConfig);

  if (!sourceProfileState.ok) {
    manualActions.push(
      `请先安装并登录 CloakBrowser，然后完成 TikTok 登录：${cloakbrowserSourceProfile}`
    );
  }

  if (!alertConfigReady) {
    manualActions.push(
      `如需飞书告警，请在 ${alertConfigPath} 中填写飞书告警接收人 dmOpenId`
    );
  }

  if (!whitelistBaseConfigReady) {
    manualActions.push(
      `请在 ${whitelistBaseConfigPath} 中填写白名单采集所需的 baseToken（以及可选 tableNames/tableMap）`
    );
  }

  if (!baseDashboardConfigReady) {
    manualActions.push(
      `如需完整 dashboard/base schema 能力，请在 ${baseDashboardConfigPath} 中填写 Base 配置的 baseToken 和 tableMap 表 ID`
    );
  }

  const checks = [
    {
      name: "bundledRuntime",
      ok: bundledRuntimeExists,
      detail: bundledCliPath,
      statusCn: bundledRuntimeExists ? "运行时已就绪" : "缺少运行时",
      autoFixed: autoActions.some((action) => action.name === "bundledRuntime")
    },
    {
      name: "monitorRepo",
      ok: repoRuntimeExists,
      detail: repoRoot,
      statusCn: repoRuntimeExists ? "已找到监控仓库" : "未找到监控仓库源码"
    },
    {
      name: "cloakbrowserSourceProfile",
      ok: sourceProfileState.ok,
      detail: cloakbrowserSourceProfile,
      statusCn: sourceProfileState.statusCn
    },
    {
      name: "alertConfig",
      ok: fs.existsSync(alertConfigPath),
      detail: alertConfigPath,
      statusCn: fs.existsSync(alertConfigPath) ? "告警配置文件已存在" : "缺少告警配置文件",
      autoFixed: autoActions.some((action) => action.name === "alertConfig")
    },
    {
      name: "alertConfigReady",
      ok: alertConfigReady,
      detail: alertConfigPath,
      statusCn: alertConfigReady ? "告警配置已填写完成" : "告警配置仍需人工填写"
    },
    {
      name: "baseDashboardConfig",
      ok: fs.existsSync(baseDashboardConfigPath),
      detail: baseDashboardConfigPath,
      statusCn: fs.existsSync(baseDashboardConfigPath) ? "Base 配置文件已存在" : "缺少 Base 配置文件",
      autoFixed: autoActions.some((action) => action.name === "baseDashboardConfig")
    },
    {
      name: "whitelistBaseConfig",
      ok: fs.existsSync(whitelistBaseConfigPath),
      detail: whitelistBaseConfigPath,
      statusCn: fs.existsSync(whitelistBaseConfigPath) ? "白名单 Base 配置文件已存在" : "缺少白名单 Base 配置文件",
      autoFixed: autoActions.some((action) => action.name === "whitelistBaseConfig")
    },
    {
      name: "whitelistBaseConfigReady",
      ok: whitelistBaseConfigReady,
      detail: whitelistBaseConfigPath,
      statusCn: whitelistBaseConfigReady ? "白名单采集 Base 配置已填写完成" : "白名单采集 Base 配置仍需人工填写"
    },
    {
      name: "baseDashboardConfigReady",
      ok: baseDashboardConfigReady,
      detail: baseDashboardConfigPath,
      statusCn: baseDashboardConfigReady ? "Base 配置已填写完成" : "Base 配置仍需人工填写"
    }
  ];

  const hardBlockers = checks.filter((check) =>
    ["bundledRuntime", "monitorRepo"].includes(check.name) && !check.ok
  );

  const blockingManualActions = manualActions.filter((item) => !item.startsWith("如需"));
  const ready = hardBlockers.length === 0 && blockingManualActions.length === 0;
  const statusCode = hardBlockers.length > 0 ? "failed" : ready ? "ready" : "needs_manual_action";
  const statusCn =
    statusCode === "ready"
      ? "可以正式采集"
      : statusCode === "needs_manual_action"
        ? "还不能正式采集，请先完成以下步骤"
        : "初始化失败，请先修复关键问题";

  return {
    plugin: "tiktok-monitor",
    developer: "Leong",
    repoRoot,
    dataDir,
    autoFix,
    ready,
    statusCode,
    statusCn,
    checks,
    autoActions,
    manualActions,
    errors,
    nextStepsCn: ready
      ? ["环境已就绪，可以直接运行正式采集。"]
      : [
          ...manualActions,
          ...(hardBlockers.length
            ? ["修复关键问题后，请重新运行 node scripts/setup.mjs 再检查状态。"]
            : ["完成上面的登录或配置后，请重新运行 node scripts/setup.mjs 再检查状态。"])
        ]
  };
}

export async function main(argv = process.argv.slice(2)) {
  const autoFix = !argv.includes("--check-only");
  const result = await inspectAndPrepareSetup({ autoFix });
  console.log(JSON.stringify(result, null, 2));
  if (result.statusCode === "failed") {
    process.exitCode = 1;
  }
}

function resolveMonitorRepoRoot(explicitRoot, cwd = process.cwd()) {
  const candidates = [];
  if (explicitRoot) candidates.push(explicitRoot);

  let current = path.resolve(cwd);
  for (let index = 0; index < 6; index += 1) {
    candidates.push(current);
    candidates.push(path.join(current, ".worktrees", "thread-tiktok-monitor"));
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

  return path.resolve(cwd);
}

function inspectSourceProfile(sourceProfilePath) {
  if (!fs.existsSync(sourceProfilePath)) {
    return {
      ok: false,
      statusCn: "未找到 CloakBrowser source-profile"
    };
  }
  const entries = safeReadDir(sourceProfilePath);
  if (!entries.length) {
    return {
      ok: false,
      statusCn: "source-profile 存在但为空，尚未登录 TikTok"
    };
  }
  const likelyProfileMarkers = [
    path.join(sourceProfilePath, "Default"),
    path.join(sourceProfilePath, "Local State"),
    path.join(sourceProfilePath, "Last Version")
  ];
  const hasMarkers = likelyProfileMarkers.some((marker) => fs.existsSync(marker));
  return {
    ok: hasMarkers || entries.length > 0,
    statusCn: hasMarkers ? "CloakBrowser source-profile 已初始化" : "source-profile 已存在，请确认已登录 TikTok"
  };
}

function hasRealAlertConfig(config) {
  const value = String(config?.dmOpenId ?? "").trim();
  return Boolean(value) && !isPlaceholder(value);
}

function hasRealBaseDashboardConfig(config) {
  const baseToken = String(config?.baseToken ?? "").trim();
  if (!baseToken || isPlaceholder(baseToken)) return false;
  const tableMap = config?.tableMap ?? {};
  const requiredKeys = ["accounts", "videos", "signals", "products"];
  return requiredKeys.every((key) => {
    const value = String(tableMap?.[key] ?? "").trim();
    return value && !isPlaceholder(value);
  });
}

function hasRealWhitelistBaseConfig(config) {
  const baseToken = String(config?.baseToken ?? "").trim();
  return Boolean(baseToken) && !isPlaceholder(baseToken);
}

function isPlaceholder(value) {
  return /replace_me|xxx/i.test(String(value ?? "").trim());
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function copyTemplateIfMissing(templatePath, targetPath) {
  if (fs.existsSync(targetPath)) return;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.copyFile(templatePath, targetPath);
}

function seedWhitelistConfigFromDashboard(baseDashboardConfigPath) {
  const dashboardConfig = readJsonFile(baseDashboardConfigPath);
  if (!dashboardConfig?.baseToken || isPlaceholder(dashboardConfig.baseToken)) {
    return null;
  }
  const nextConfig = {
    baseToken: dashboardConfig.baseToken
  };
  if (dashboardConfig.url) {
    nextConfig.url = dashboardConfig.url;
  }
  return nextConfig;
}

async function writeJsonFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

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

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main();
}
