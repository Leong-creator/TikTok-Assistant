import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAssetPackage } from "../src/pipeline.mjs";

const sampleScript = `
Why do honest people always lose in business?
A young hotel owner was drowning in rent and bills.
Then a visitor showed him how one empty room could become a cash machine.
The lesson was simple: poor people sell time, rich people design systems.
If you want to understand that difference, you need to read this book.
`;

test("generateAssetPackage creates a CapCut-ready test package with manifests and review logs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-pipeline-"));
  try {
    const result = await generateAssetPackage({
      script: sampleScript,
      outputRoot: root,
      slug: "hotel-money",
      mode: "test",
      provider: "mock",
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    assert.equal(path.basename(result.packageDir), "2026-05-09-hotel-money");
    assert.equal(result.summary.totalShots, 20);
    assert.equal(result.summary.videoShots, 5);
    assert.equal(result.summary.imageShots, 15);

    const requiredFiles = [
      "00_script/original.txt",
      "00_script/localized.txt",
      "01_storyboard/storyboard.json",
      "02_prompts/prompts.json",
      "06_editing_package/editing_manifest.csv",
      "06_editing_package/editing_manifest.json",
      "06_editing_package/manual_capcut_steps.md",
      "07_review_log/prompt_iterations.jsonl",
      "07_review_log/needs_manual_review.json",
      "07_review_log/checkpoint_log.md"
    ];

    for (const relativePath of requiredFiles) {
      await stat(path.join(result.packageDir, relativePath));
    }

    const prompts = JSON.parse(await readFile(path.join(result.packageDir, "02_prompts/prompts.json"), "utf8"));
    assert.equal(prompts.length, 20);
    assert.match(prompts[0].imagePrompt, /american semi-realistic comic illustration/i);
    assert.match(prompts[0].imagePrompt, /9:16 vertical/i);

    const manifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    assert.equal(manifest.shots.length, 20);
    assert.equal(manifest.shots.filter((shot) => shot.assetType === "video").length, 5);
    assert.equal(manifest.shots.filter((shot) => shot.assetType === "image").length, 15);
    assert.ok(manifest.shots.every((shot) => shot.assetPath));

    const reviewLog = await readFile(path.join(result.packageDir, "07_review_log/prompt_iterations.jsonl"), "utf8");
    const reviewLines = reviewLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(reviewLines.length, 20);
    assert.ok(reviewLines.every((line) => line.status === "accepted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generateAssetPackage records manual review when mock provider rejects a shot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-pipeline-"));
  try {
    const result = await generateAssetPackage({
      script: sampleScript,
      outputRoot: root,
      slug: "review-needed",
      mode: "test",
      provider: "mock",
      now: new Date("2026-05-09T00:00:00+08:00"),
      forceRejectShotIds: ["S003"]
    });

    const needsManualReview = JSON.parse(
      await readFile(path.join(result.packageDir, "07_review_log/needs_manual_review.json"), "utf8")
    );
    assert.equal(needsManualReview.length, 1);
    assert.equal(needsManualReview[0].shotId, "S003");
    assert.equal(needsManualReview[0].attempts, 3);
    assert.match(needsManualReview[0].reason, /manual review/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generateAssetPackage keeps U.S. dollars together when splitting storyboard lines", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-pipeline-"));
  try {
    const result = await generateAssetPackage({
      script: "She paid in U.S. dollars, smiled at everyone, and looked calm. Then she made a boundary mistake.",
      outputRoot: root,
      slug: "abbreviation-split",
      mode: "test",
      provider: "mock",
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    const storyboard = JSON.parse(
      await readFile(path.join(result.packageDir, "01_storyboard/storyboard.json"), "utf8")
    );
    assert.equal(storyboard[0].line, "She paid in U.S. dollars, smiled at everyone, and looked calm.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
