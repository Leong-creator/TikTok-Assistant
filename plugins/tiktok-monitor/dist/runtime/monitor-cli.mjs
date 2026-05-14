#!/usr/bin/env node
import path from "node:path";

import { parseTargets, resolveMonitorConfig } from "./monitor/config.mjs";
import { syncFeishuBaseDashboard } from "./monitor/base-dashboard.mjs";
import { createCollectionPlan, readCollectionCursor, readCollectionPlan } from "./monitor/collection-plan.mjs";
import { createFeishuNotifier } from "./monitor/alerts.mjs";
import { runMonitorCycle } from "./monitor/monitor-cycle.mjs";
import { sendMonitorReport } from "./monitor/reporting.mjs";
import { importSeedsFromFeishuWiki, mergeHistoricalSeedRuns, promoteAccountCandidates } from "./monitor/seed-importer.mjs";
import { readJsonFile } from "./monitor/storage.mjs";
import {
  analyzeMonitorData,
  collectMonitorSnapshots,
  runMonitorOnce,
  sendMonitorAlerts
} from "./monitor/runner.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const defaults = resolveMonitorConfig(process.env);

try {
  const result = await runCommand(command, args, defaults);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function runCommand(command, args, defaults) {
  if (!command || args.help) {
    return {
      usage:
        "node src/monitor-cli.mjs <run-once|monitor-cycle|collect|collect-plan|collect-status|collect-persistent-batch|collect-cobrowser-batch|analyze|alert|report|seed import-feishu|seed merge-runs|seed promote-candidates|base-sync> [--source mock|chrome|playwright-persistent|cobrowser] [--targets accounts,shops] [--data-dir monitoring_data]"
    };
  }

  const dataDir = path.resolve(args["data-dir"] ?? defaults.dataDir);
  const targets = parseTargets(args.targets ?? defaults.targets.join(","));
  const now = args.now ? new Date(args.now) : new Date();
  const config = {
    maxTabs: numberArg(args["max-tabs"], defaults.maxTabs),
    maxVideosPerAccount: numberArg(args["max-videos-per-account"], defaults.maxVideosPerAccount),
    maxProductsPerShop: numberArg(args["max-products-per-shop"], defaults.maxProductsPerShop),
    staleAccountDays: numberArg(args["stale-account-days"], defaults.staleAccountDays),
    min3hViews: numberArg(args["min-3h-views"], defaults.min3hViews),
    min6hViews: numberArg(args["min-6h-views"], defaults.min6hViews),
    min24hViews: numberArg(args["min-24h-views"], defaults.min24hViews),
    min3hLikes: numberArg(args["min-3h-likes"], defaults.min3hLikes),
    min3hShares: numberArg(args["min-3h-shares"], defaults.min3hShares),
    min3hComments: numberArg(args["min-3h-comments"], defaults.min3hComments),
    maxAccounts: numberArg(args["max-accounts"], undefined),
    maxShops: numberArg(args["max-shops"], undefined),
    maxSeedVideos: numberArg(args["max-seed-videos"], undefined),
    maxBatchIterations: numberArg(args["max-batch-iterations"], undefined),
    playwrightProfileDir: args["playwright-profile-dir"] ?? defaults.playwrightProfileDir,
    playwrightSourceProfileDir: args["playwright-source-profile-dir"] ?? defaults.playwrightSourceProfileDir,
    playwrightSeedProfileDir: args["playwright-seed-profile-dir"] ?? defaults.playwrightSeedProfileDir,
    playwrightHeadless: booleanArg(args["playwright-headless"], defaults.playwrightHeadless),
    playwrightChannel: args["playwright-channel"] ?? defaults.playwrightChannel,
    cobrowserRoot: args["cobrowser-root"] ?? defaults.cobrowserRoot,
    cobrowserRuntimeModule: args["cobrowser-runtime-module"] ?? defaults.cobrowserRuntimeModule,
    cobrowserHeadless: booleanArg(args["cobrowser-headless"], defaults.cobrowserHeadless),
    cobrowserProfile: args["cobrowser-profile"] ?? defaults.cobrowserProfile,
    cobrowserFresh: booleanArg(args["cobrowser-fresh"], defaults.cobrowserFresh),
    publicFirst: defaults.publicFirst,
    requireLoginOnBlock: defaults.requireLoginOnBlock,
    refreshPlan: booleanArg(args["refresh-plan"], false)
  };
  const source = args.source ?? defaults.source;
  const alertMode = normalizeAlertMode(args.channel ?? args["alert-mode"] ?? defaults.feishuAlertMode);
  const alertRecipient = await resolveAlertRecipient({
    dataDir,
    explicitRecipient: args["alert-recipient"],
    alertMode,
    defaults
  });
  const notifier = args["dry-run-alerts"]
    ? {
        async send() {
          return { status: "sent", messageId: "dry-run" };
        }
      }
    : undefined;

  if (command === "seed" && args._[1] === "import-feishu") {
    return importSeedsFromFeishuWiki({
      dataDir,
      url: args.url,
      fromFile: args["from-file"]
    });
  }

  if (command === "seed" && args._[1] === "merge-runs") {
    return mergeHistoricalSeedRuns({
      dataDir,
      runDirs: parseListArg(args["run-dirs"])
    });
  }

  if (command === "seed" && args._[1] === "promote-candidates") {
    return promoteAccountCandidates({
      dataDir,
      handles: parseListArg(args.handles)
    });
  }

  if (command === "base-sync") {
    return syncFeishuBaseDashboard({
      dataDir,
      baseToken: args["base-token"] ?? defaults.feishuBaseToken,
      tableMap: parseJsonArg(args["table-map"] ?? process.env.FEISHU_BASE_TABLE_MAP),
      dryRun: Boolean(args["dry-run"])
    });
  }

  if (command === "collect-plan") {
    return createCollectionPlan({ dataDir, now });
  }

  if (command === "collect-status") {
    return {
      plan: await readCollectionPlan(dataDir),
      cursor: await readCollectionCursor(dataDir)
    };
  }

  if (command === "collect-persistent-batch") {
    const { runPlaywrightPersistentMonitorBatch } = await loadPersistentBatchRunner();
    return runPlaywrightPersistentMonitorBatch({
      dataDir,
      now,
      refreshPlan: Boolean(args["refresh-plan"]),
      config
    });
  }

  if (command === "collect-cobrowser-batch") {
    const { runCoBrowserMonitorBatch } = await loadCoBrowserBatchRunner();
    return runCoBrowserMonitorBatch({
      dataDir,
      now,
      refreshPlan: Boolean(args["refresh-plan"]),
      config
    });
  }

  if (alertMode === "chat") {
    throw new Error("group alerts are disabled during the Feishu private-message test phase");
  }
  if ((command === "run-once" || command === "monitor-cycle" || command === "alert" || command === "report") && !args["dry-run-alerts"] && !alertRecipient) {
    throw new Error("FEISHU_DM_OPEN_ID or --alert-recipient is required unless --dry-run-alerts is set");
  }

  if (command === "run-once") {
    return runMonitorOnce({
      dataDir,
      source,
      targets,
      now,
      config,
      alertMode,
      alertRecipient,
      notifier
    });
  }
  if (command === "monitor-cycle") {
    return runMonitorCycle({
      dataDir,
      now,
      source,
      config,
      alertMode,
      alertRecipient,
      notifier
    });
  }
  if (command === "collect") {
    return collectMonitorSnapshots({
      dataDir,
      source,
      targets,
      now,
      config
    });
  }
  if (command === "analyze") {
    return analyzeMonitorData({ dataDir, now, config });
  }
  if (command === "alert") {
    return sendMonitorAlerts({
      dataDir,
      now,
      alertMode,
      alertRecipient,
      notifier
    });
  }
  if (command === "report") {
    return sendMonitorReport({
      dataDir,
      now,
      recentWindowHours: numberArg(args["recent-window-hours"], 24),
      maxSignals: numberArg(args["max-signals"], 5),
      alertMode,
      alertRecipient,
      notifier: notifier ?? createFeishuNotifier({
        mode: alertMode,
        dmOpenId: alertMode === "dm" ? alertRecipient : undefined,
        chatId: alertMode === "chat" ? alertRecipient : undefined
      })
    });
  }
  throw new Error(`unsupported monitor command: ${command}`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return Number(value);
}

function booleanArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return /^(1|true|yes)$/iu.test(String(value));
}

function normalizeAlertMode(value) {
  if (value === "feishu-dm") return "dm";
  if (value === "feishu-chat") return "chat";
  return value;
}

function parseJsonArg(value) {
  if (!value || value === true) return undefined;
  return JSON.parse(value);
}

function parseListArg(value) {
  if (!value || value === true) return undefined;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadPersistentBatchRunner() {
  try {
    return await import("./monitor/playwright-persistent-runner.mjs");
  } catch (error) {
    if (isMissingPersistentBatchRunner(error)) {
      throw new Error(
        "playwright-persistent runner module is not available yet; add src/monitor/playwright-persistent-runner.mjs before using collect-persistent-batch"
      );
    }
    throw error;
  }
}

async function loadCoBrowserBatchRunner() {
  try {
    return await import("./monitor/cobrowser-runner.mjs");
  } catch (error) {
    if (isMissingModule(error, "cobrowser-runner.mjs")) {
      throw new Error(
        "cobrowser runner module is not available yet; add src/monitor/cobrowser-runner.mjs before using collect-cobrowser-batch"
      );
    }
    throw error;
  }
}

function isMissingPersistentBatchRunner(error) {
  return isMissingModule(error, "playwright-persistent-runner.mjs");
}

function isMissingModule(error, moduleName) {
  return error?.code === "ERR_MODULE_NOT_FOUND" &&
    String(error?.message ?? "").includes(moduleName);
}

async function resolveAlertRecipient({ dataDir, explicitRecipient, alertMode, defaults }) {
  if (explicitRecipient) return explicitRecipient;
  const configRecipient = alertMode === "chat" ? defaults.feishuAlertChatId : defaults.feishuDmOpenId;
  if (configRecipient) return configRecipient;
  const alertConfig = await readJsonFile(path.join(dataDir, "alert_config.json"), {});
  return alertMode === "chat" ? alertConfig.chatId : alertConfig.dmOpenId;
}
