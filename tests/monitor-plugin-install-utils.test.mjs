import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildPosixLauncher,
  buildWindowsCmdLauncher,
  buildWindowsPowerShellLauncher,
  resolveLauncherInstallTargets
} from "../plugins/tiktok-monitor/scripts/install-utils.mjs";

test("resolveLauncherInstallTargets uses APPDATA npm on Windows", () => {
  const targets = resolveLauncherInstallTargets({
    platform: "win32",
    env: {
      APPDATA: "C:\\Users\\EDY\\AppData\\Roaming"
    },
    homeDir: "C:\\Users\\EDY"
  });

  assert.equal(targets.binDir, "C:\\Users\\EDY\\AppData\\Roaming\\npm");
  assert.equal(targets.commandPath, "C:\\Users\\EDY\\AppData\\Roaming\\npm\\tiktok-monitor.cmd");
  assert.equal(targets.powerShellPath, "C:\\Users\\EDY\\AppData\\Roaming\\npm\\tiktok-monitor.ps1");
});

test("resolveLauncherInstallTargets uses local bin on posix", () => {
  const targets = resolveLauncherInstallTargets({
    platform: "linux",
    env: {},
    homeDir: "/home/edy"
  });

  assert.equal(targets.binDir, path.join("/home/edy", ".local", "bin"));
  assert.equal(targets.commandPath, path.join("/home/edy", ".local", "bin", "tiktok-monitor"));
});

test("launcher builders point to the launcher script", () => {
  const scriptPath = "C:\\Users\\EDY\\plugins\\tiktok-monitor\\scripts\\tiktok-monitor-launcher.mjs";
  assert.match(buildWindowsCmdLauncher(scriptPath), /tiktok-monitor-launcher\.mjs/);
  assert.match(buildWindowsPowerShellLauncher(scriptPath), /tiktok-monitor-launcher\.mjs/);
  assert.match(buildPosixLauncher("/home/edy/plugins/tiktok-monitor/scripts/tiktok-monitor-launcher.mjs"), /tiktok-monitor-launcher\.mjs/);
});
