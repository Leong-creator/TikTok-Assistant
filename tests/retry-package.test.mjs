import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAssetPackage, retryPackageShots } from "../src/pipeline.mjs";

const sampleScript = `
Why do parents make the same boundary mistake?
A woman kept saying yes until the living room no longer felt like her home.
The mentor told her that kindness without a line becomes pressure.
The strongest parents teach children to solve problems before the outside world does.
This book gives parents the language for that lesson.
`;

test("retryPackageShots regenerates only selected shots and updates manifest/review logs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-retry-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script: sampleScript,
      outputRoot: root,
      slug: "retry-selected",
      mode: "test",
      provider: "mock",
      imageOnly: true,
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    const retry = await retryPackageShots({
      packageDir: result.packageDir,
      shots: ["S015", "S016"],
      provider: "dreamina-image",
      providerAdapters: {
        dreaminaImage: fakeRetryProvider(calls)
      },
      now: new Date("2026-05-09T01:00:00+08:00")
    });

    assert.deepEqual(retry.retriedShotIds, ["S015", "S016"]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.shotId), ["S015", "S016"]);

    const manifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    const s015 = manifest.shots.find((shot) => shot.shotId === "S015");
    const s016 = manifest.shots.find((shot) => shot.shotId === "S016");
    assert.equal(s015.provider, "dreamina-image");
    assert.match(s015.assetPath, /^04_bulk_images_dreamina\/S015_dreamina-image_retry/);
    assert.equal(s016.provider, "dreamina-image");
    assert.match(s016.assetPath, /^04_bulk_images_dreamina\/S016_dreamina-image_retry/);

    const reviewLog = await readFile(path.join(result.packageDir, "07_review_log/prompt_iterations.jsonl"), "utf8");
    const reviewLines = reviewLog.trim().split("\n").map((line) => JSON.parse(line));
    const retryLines = reviewLines.filter((line) => line.retry === true);
    assert.deepEqual(retryLines.map((line) => line.shotId), ["S015", "S016"]);
    assert.ok(retryLines.every((line) => line.status === "accepted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakeRetryProvider(calls) {
  return {
    async generate({ packageDir, prompt, folder, provider }) {
      calls.push({ shotId: prompt.shotId, prompt: prompt.generationPrompt });
      const relativePath = path.join(folder, `${prompt.shotId}_${provider}_retry.png`).replaceAll("\\", "/");
      const absolutePath = path.join(packageDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "retry image");
      return {
        shotId: prompt.shotId,
        assetType: "image",
        provider,
        relativePath,
        absolutePath
      };
    }
  };
}
