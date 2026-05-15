import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createHeadedChatGptLaunchOptions,
  createPersistentChromeLaunchOptions,
  createPlaywrightLaunchOptions,
  defaultPersistentBrowserRoot,
  ensureSeededProfile,
  resolvePersistentBrowserProfiles,
  startPlaywrightPersistentContext
} from "../src/monitor/playwright-persistent-runtime.mjs";

test("createPlaywrightLaunchOptions builds persistent chrome launch config", () => {
  const options = createPlaywrightLaunchOptions({
    headless: true,
    channel: "chrome"
  });

  assert.equal(options.channel, "chrome");
  assert.equal(options.headless, true);
  assert.equal(options.acceptDownloads, false);
  assert.deepEqual(options.viewport, { width: 1440, height: 960 });
  assert.match(options.args.join(" "), /disable-blink-features=AutomationControlled/);
  assert.match(options.args.join(" "), /window-size=1440,960/);
});

test("persistent runtime exposes shared-root profile resolution and headed download-capable launch options", () => {
  const root = defaultPersistentBrowserRoot({ homeDir: "C:/Users/EDY" });
  const profiles = resolvePersistentBrowserProfiles({
    rootDir: root,
    runName: "chatgpt-web-run-profile-headed"
  });
  const headed = createHeadedChatGptLaunchOptions({ channel: "msedge" });
  const generic = createPersistentChromeLaunchOptions({ headless: false, acceptDownloads: true });

  assert.equal(root, path.join("C:/Users/EDY", ".codex", "persistent-browser-profiles"));
  assert.equal(profiles.sourceProfileDir, path.resolve(path.join(root, "shared-source-profile")));
  assert.equal(profiles.runProfileDir, path.resolve(path.join(root, "chatgpt-web-run-profile-headed")));
  assert.equal(headed.headless, false);
  assert.equal(headed.acceptDownloads, true);
  assert.equal(headed.channel, "msedge");
  assert.equal(generic.acceptDownloads, true);
});

test("ensureSeededProfile copies a seed profile without browser lock and cache files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "tk-playwright-runtime-"));
  try {
    const seedProfileDir = path.join(tempRoot, "seed");
    const profileDir = path.join(tempRoot, "profile");
    await mkdir(path.join(seedProfileDir, "Default"), { recursive: true });
    await mkdir(path.join(seedProfileDir, "Cache"), { recursive: true });
    await mkdir(path.join(seedProfileDir, "GPUCache"), { recursive: true });
    await writeFile(path.join(seedProfileDir, "Default", "Preferences"), "{\"profile\":true}");
    await writeFile(path.join(seedProfileDir, "SingletonLock"), "locked");
    await writeFile(path.join(seedProfileDir, "Cache", "entry.bin"), "cache");
    await writeFile(path.join(seedProfileDir, "GPUCache", "gpu.bin"), "gpu");

    const copied = ensureSeededProfile({ profileDir, seedProfileDir });

    assert.equal(copied, true);
    assert.equal(existsSync(path.join(profileDir, "Default", "Preferences")), true);
    assert.equal(existsSync(path.join(profileDir, "SingletonLock")), false);
    assert.equal(existsSync(path.join(profileDir, "Cache")), false);
    assert.equal(existsSync(path.join(profileDir, "GPUCache")), false);
    assert.equal(await readFile(path.join(profileDir, "Default", "Preferences"), "utf8"), "{\"profile\":true}");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ensureSeededProfile prefers sourceProfileDir and leaves no temporary seed folder behind", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "tk-playwright-runtime-source-"));
  try {
    const sourceProfileDir = path.join(tempRoot, "source");
    const seedProfileDir = path.join(tempRoot, "seed");
    const profileDir = path.join(tempRoot, "profile");
    await mkdir(path.join(sourceProfileDir, "Default"), { recursive: true });
    await mkdir(path.join(seedProfileDir, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfileDir, "Default", "Preferences"), "{\"profile\":\"source\"}");
    await writeFile(path.join(seedProfileDir, "Default", "Preferences"), "{\"profile\":\"seed\"}");

    const copied = ensureSeededProfile({ profileDir, sourceProfileDir, seedProfileDir });

    assert.equal(copied, true);
    assert.equal(await readFile(path.join(profileDir, "Default", "Preferences"), "utf8"), "{\"profile\":\"source\"}");
    const leftovers = (await readdir(tempRoot)).filter((entry) => entry.startsWith("profile.seed-"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ensureSeededProfile throws when an explicit source profile is missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "tk-playwright-runtime-missing-"));
  try {
    await assert.throws(
      () =>
        ensureSeededProfile({
          profileDir: path.join(tempRoot, "profile"),
          sourceProfileDir: path.join(tempRoot, "missing-source")
        }),
      /Source profile missing:/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("startPlaywrightPersistentContext seeds the profile and launches chromium with resolved profile dir", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "tk-playwright-launch-"));
  try {
    const sourceProfileDir = path.join(tempRoot, "source");
    const relativeProfileDir = path.join(".", path.relative(process.cwd(), path.join(tempRoot, "profile")));
    await mkdir(path.join(sourceProfileDir, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfileDir, "Default", "Preferences"), "{\"seeded\":true}");

    const calls = [];
    const context = { marker: "context" };
    const playwright = {
      chromium: {
        async launchPersistentContext(userDataDir, options) {
          calls.push({ userDataDir, options });
          return context;
        }
      }
    };

    const result = await startPlaywrightPersistentContext({
      playwright,
      profileDir: relativeProfileDir,
      sourceProfileDir,
      headless: false,
      channel: "msedge"
    });

    assert.equal(result, context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].userDataDir, path.resolve(relativeProfileDir));
    assert.equal(calls[0].options.channel, "msedge");
    assert.equal(calls[0].options.headless, false);
    assert.equal(existsSync(path.join(path.resolve(relativeProfileDir), "Default", "Preferences")), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
