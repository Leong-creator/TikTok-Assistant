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
  const coverage = summarizeCycleCoverage(batches);

  let analysis = { signals: 0 };
  let baseSync = null;
  let report = null;

  if (newSnapshots > 0) {
    analysis = await (config.analyzeMonitorData ?? analyzeMonitorData)({ dataDir, now: new Date(), config });
    baseSync = await (config.syncFeishuBaseDashboard ?? syncFeishuBaseDashboard)({
      dataDir,
      baseToken: config.feishuBaseToken,
      tableMap: config.feishuBaseTableMap,
      baseDashboardConfigPath: config.baseDashboardConfigPath,
      recordMapPath: config.recordMapPath,
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
    coverage,
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

function summarizeCycleCoverage(batches = []) {
  const planned = batches.find((batch) => batch?.planned) ?? {};
  const plannedCounts = planned.planned ?? {};
  const plannedAccounts = Number(plannedCounts.accountTargets ?? plannedCounts.accounts ?? sumBatchField(batches, "accounts"));
  const plannedVideos = Number(plannedCounts.videoTargets ?? sumBatchField(batches, "videos"));
  const processedAccounts = sumBatchField(batches, "accounts");
  const processedVideos = sumBatchField(batches, "videos");
  const refreshedVideoSnapshots = batches.reduce(
    (total, batch) => total + Number(batch?.snapshots?.video ?? 0),
    0
  );
  const failedTargets = batches.reduce(
    (total, batch) => total + Number(batch?.failures?.length ?? 0),
    0
  );

  return {
    plannedAccounts,
    plannedVideos,
    processedAccounts,
    processedVideos,
    accountBatchCompleted: processedAccounts >= plannedAccounts,
    videoBatchCompleted: processedVideos >= plannedVideos,
    targetProcessingCompleted: processedAccounts >= plannedAccounts && processedVideos >= plannedVideos,
    refreshedVideoSnapshots,
    failedTargets
  };
}

function sumBatchField(batches = [], key) {
  return batches.reduce((total, batch) => total + Number(batch?.batch?.[key] ?? 0), 0);
}
