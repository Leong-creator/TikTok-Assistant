import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createBatchPlanner } from "../src/batch-planner.mjs";
import {
  applyCollectedImagesToManifest,
  collectDownloadedImages,
  snapshotDownloadDirectory
} from "../src/download-collector.mjs";

test("ChatGPT batch planner grows after clean batches and drops to one after quality failure", () => {
  const planner = createBatchPlanner({ initialSize: 3, maxSize: 10 });

  assert.equal(planner.nextBatchSize(), 3);

  planner.recordBatchResult({ requested: 3, accepted: 3, qualityOk: true });
  assert.equal(planner.nextBatchSize(), 5);

  planner.recordBatchResult({ requested: 5, accepted: 5, qualityOk: true });
  assert.equal(planner.nextBatchSize(), 10);

  planner.recordBatchResult({ requested: 10, accepted: 7, qualityOk: false, issue: "style drift" });
  assert.equal(planner.nextBatchSize(), 1);

  planner.recordBatchResult({ requested: 1, accepted: 1, qualityOk: true });
  assert.equal(planner.nextBatchSize(), 3);
});

test("download collector moves new ChatGPT files into the package and writes a move log", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-downloads-"));
  try {
    const downloads = path.join(root, "Downloads");
    const packageDir = path.join(root, "package");
    await mkdir(downloads, { recursive: true });
    await mkdir(packageDir, { recursive: true });

    await writeFile(path.join(downloads, "old-image.png"), "old");
    const beforeSnapshot = await snapshotDownloadDirectory(downloads);

    await writeFile(path.join(downloads, "generated-one.png"), "one");
    await writeFile(path.join(downloads, "generated-two.webp"), "two");

    const moved = await collectDownloadedImages({
      downloadDir: downloads,
      beforeSnapshot,
      packageDir,
      folder: "03_key_images_chatgpt",
      assignments: [
        { shotId: "S001", provider: "chatgpt-web-image2", attempt: 1 },
        { shotId: "S002", provider: "chatgpt-web-image2", attempt: 1 }
      ],
      logPath: path.join(packageDir, "07_review_log/download_moves.jsonl")
    });

    assert.deepEqual(
      moved.map((item) => path.basename(item.to)),
      ["S001_chatgpt-web-image2_a1.png", "S002_chatgpt-web-image2_a1.webp"]
    );
    await stat(path.join(packageDir, "03_key_images_chatgpt/S001_chatgpt-web-image2_a1.png"));
    await stat(path.join(packageDir, "03_key_images_chatgpt/S002_chatgpt-web-image2_a1.webp"));

    const moveLog = await readFile(path.join(packageDir, "07_review_log/download_moves.jsonl"), "utf8");
    const moveLines = moveLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(moveLines.length, 2);
    assert.equal(moveLines[0].shotId, "S001");
    assert.match(moveLines[0].from, /generated-one\.png$/);
    assert.match(moveLines[0].to, /S001_chatgpt-web-image2_a1\.png$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collected ChatGPT downloads can be reconciled into the editing manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-download-manifest-"));
  try {
    const packageDir = path.join(root, "package");
    await mkdir(path.join(packageDir, "06_editing_package"), { recursive: true });
    await mkdir(path.join(packageDir, "03_key_images_chatgpt"), { recursive: true });
    await writeFile(path.join(packageDir, "03_key_images_chatgpt/S001_chatgpt-web-image2_a2.png"), "real");

    const manifest = {
      provider: "mock",
      shots: [
        {
          shotId: "S001",
          order: 1,
          category: "make_money",
          storyCategory: "make_money",
          productCategory: "raise_children",
          assetType: "image",
          storyboardAssetType: "video",
          provider: "mock",
          assetPath: "03_key_images_chatgpt/S001_mock.svg",
          durationSeconds: 5,
          captionText: "hook",
          suggestedEdit: "push in",
          promptPreset: "business-storyboard",
          attempts: 1
        }
      ]
    };
    await writeFile(path.join(packageDir, "06_editing_package/editing_manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(packageDir, "06_editing_package/editing_manifest.csv"), "old");

    const updates = await applyCollectedImagesToManifest({
      packageDir,
      moved: [
        {
          shotId: "S001",
          provider: "chatgpt-web-image2",
          attempt: 2,
          to: path.join(packageDir, "03_key_images_chatgpt/S001_chatgpt-web-image2_a2.png")
        }
      ]
    });

    assert.deepEqual(updates, [
      {
        shotId: "S001",
        provider: "chatgpt-web-image2",
        assetPath: "03_key_images_chatgpt/S001_chatgpt-web-image2_a2.png",
        attempts: 2
      }
    ]);
    const updatedManifest = JSON.parse(await readFile(path.join(packageDir, "06_editing_package/editing_manifest.json"), "utf8"));
    assert.equal(updatedManifest.shots[0].provider, "chatgpt-web-image2");
    assert.equal(updatedManifest.shots[0].assetPath, "03_key_images_chatgpt/S001_chatgpt-web-image2_a2.png");
    assert.equal(updatedManifest.shots[0].attempts, 2);
    const csv = await readFile(path.join(packageDir, "06_editing_package/editing_manifest.csv"), "utf8");
    assert.match(csv, /S001_chatgpt-web-image2_a2\.png/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
