import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAssetPackage } from "../src/pipeline.mjs";

const sampleScript = `
Why do parents keep raising children who cannot handle pressure?
A woman tried to protect everyone and slowly lost control of her own home.
Then an older mentor showed her the difference between kindness and weak boundaries.
The lesson is simple: children need real problem solving, not perfect protection.
Every parent should understand this before the child meets the outside world.
`;

test("pipeline writes Pixelle-style phase checkpoints and package index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-lifecycle-"));
  try {
    const result = await generateAssetPackage({
      script: sampleScript,
      outputRoot: root,
      slug: "parent-boundaries",
      mode: "test",
      provider: "mock",
      imageOnly: true,
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    const checkpointLog = await readFile(
      path.join(result.packageDir, "07_review_log/pipeline_checkpoints.jsonl"),
      "utf8"
    );
    const checkpoints = checkpointLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      checkpoints.map((checkpoint) => checkpoint.phase),
      ["preparePackage", "buildStoryboard", "planPrompts", "generateAssets", "reviewAssets", "finalizePackage"]
    );
    assert.ok(checkpoints.every((checkpoint) => checkpoint.status === "completed"));
    assert.ok(checkpoints.every((checkpoint) => checkpoint.timestamp));

    const index = JSON.parse(await readFile(path.join(root, ".index.json"), "utf8"));
    assert.equal(index.version, 1);
    assert.equal(index.packages.length, 1);
    assert.equal(index.packages[0].slug, "parent-boundaries");
    assert.equal(index.packages[0].status, "completed");
    assert.equal(index.packages[0].provider, "mock");
    assert.equal(index.packages[0].scriptTitle, "Why do parents keep raising children who cannot handle pressure?");
    assert.equal(index.packages[0].generated.total, 20);
    assert.equal(index.packages[0].generated.accepted, 20);
    assert.equal(index.packages[0].manualReview, 0);
    assert.equal(path.resolve(index.packages[0].path), result.packageDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume checkpoints record the requested resume phase", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-resume-"));
  try {
    const result = await generateAssetPackage({
      script: sampleScript,
      outputRoot: root,
      slug: "resume-parent-boundaries",
      mode: "test",
      provider: "mock",
      imageOnly: true,
      resumeFrom: "planPrompts",
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    const checkpointLog = await readFile(
      path.join(result.packageDir, "07_review_log/pipeline_checkpoints.jsonl"),
      "utf8"
    );
    const checkpoints = checkpointLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(checkpoints[0].phase, "preparePackage");
    assert.equal(checkpoints[0].resumeFrom, "planPrompts");
    assert.ok(checkpoints.some((checkpoint) => checkpoint.phase === "planPrompts" && checkpoint.resumed === true));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
