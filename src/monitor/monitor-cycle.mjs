import path from "node:path";

import { createFeishuNotifier } from "./alerts.mjs";
import { syncFeishuBaseDashboard } from "./base-dashboard.mjs";
import { runCloakBrowserMonitorBatch } from "./cloakbrowser-runner.mjs";
import { runCoBrowserMonitorBatch } from "./cobrowser-runner.mjs";
import { sendMonitorReport } from "./reporting.mjs";
import { analyzeMonitorData } from "./runner.mjs";
import { readJsonLines } from "./storage.mjs";
import { runPlaywrightPersistentMonitorBatch } from "./playwright-persistent-runner.mjs";

export async function runMonitorCycle({
  dataDir = "monitoring_data",
  now = new Date(),
  source = "cloakbrowser",
  config = {},
  alertMode = "dm",
  alertRecipient,
  notifier
} = {}) {
  const snapshotPath = path.join(dataDir, "snapshots", "video_snapshots.jsonl");
  const beforeCount = (await readJsonLines(snapshotPath)).length;
  const batches = [];
  const maxBatchIterations = numberOrDefault(config.maxBatchIterations, 40);

  for (let index = 0; index < maxBatchIterations; index += 1) {
    const batchNow = new Date();
    const batchResult = await runMonitorBatch({
      source,
      dataDir,
      now: batchNow,
      config,
      refreshPlan: index === 0 ? Boolean(config.refreshPlan) : false
    });
    batches.push(batchResult);
    if (batchResult.batch?.done || batchResult.cursor?.completed) {
      break;
    }
  }

  const afterCount = (await readJsonLines(snapshotPath)).length;
  const newSnapshots = Math.max(0, afterCount - beforeCount);

  let analysis = { signals: 0 };
  let baseSync = null;
  let report = null;

  if (newSnapshots > 0) {
    analysis = await (config.analyzeMonitorData ?? analyzeMonitorData)({ dataDir, now: new Date(), config });
    baseSync = await (config.syncFeishuBaseDashboard ?? syncFeishuBaseDashboard)({
      dataDir,
      baseToken: config.feishuBaseToken,
      tableMap: config.feishuBaseTableMap,
      dryRun: Boolean(config.baseSyncDryRun)
    });
    report = await (config.sendMonitorReport ?? sendMonitorReport)({
      dataDir,
      now: new Date(),
      recentWindowHours: numberOrDefault(config.recentWindowHours, 24),
      maxSignals: numberOrDefault(config.maxSignals, 5),
      alertMode,
      alertRecipient,
      notifier: notifier ?? createFeishuNotifier({
        mode: alertMode,
        dmOpenId: alertMode === "dm" ? alertRecipient : undefined,
        chatId: alertMode === "chat" ? alertRecipient : undefined
      })
    });
  }

  return {
    source,
    newSnapshots,
    batches,
    analysis,
    baseSync,
    report
  };
}

async function runMonitorBatch({ source, dataDir, now, config, refreshPlan }) {
  if (source === "cloakbrowser") {
    return (config.runCloakBrowserMonitorBatch ?? runCloakBrowserMonitorBatch)({ dataDir, now, config, refreshPlan });
  }
  if (source === "cobrowser") {
    return (config.runCoBrowserMonitorBatch ?? runCoBrowserMonitorBatch)({ dataDir, now, config, refreshPlan });
  }
  if (source === "playwright-persistent") {
    return (config.runPlaywrightPersistentMonitorBatch ?? runPlaywrightPersistentMonitorBatch)({
      dataDir,
      now,
      config,
      refreshPlan
    });
  }
  throw new Error(`unsupported monitor-cycle source: ${source}`);
}

function numberOrDefault(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}
