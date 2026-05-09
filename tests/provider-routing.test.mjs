import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAssetPackage } from "../src/pipeline.mjs";

const script = `
Why do people with no money keep losing the same game?
A young business owner worked all day but still could not pay the rent.
Then an older mentor showed him the system hidden behind empty rooms and cash flow.
The poor chase effort, but the rich build machines that keep working after they leave.
This book explains the difference in a way anyone can understand.
`;

test("image-mvp routes key images to ChatGPT web image-2 and bulk stills to Dreamina", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-image-mvp-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script,
      outputRoot: root,
      slug: "provider-routing",
      mode: "test",
      provider: "image-mvp",
      imageOnly: true,
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        chatgptWebImage2: fakeImageProvider("chatgpt-web-image2", calls),
        dreaminaImage: fakeImageProvider("dreamina-image", calls)
      }
    });

    assert.equal(result.summary.provider, "image-mvp");
    assert.equal(result.summary.totalShots, 20);
    assert.equal(result.summary.videoShots, 5);
    assert.equal(result.summary.imageShots, 15);

    assert.deepEqual(
      calls.slice(0, 3).map((call) => call.provider),
      ["chatgpt-web-image2", "chatgpt-web-image2", "chatgpt-web-image2"]
    );
    assert.ok(calls.slice(3).every((call) => call.provider === "dreamina-image"));
    assert.equal(calls.length, 20);

    const manifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    assert.equal(manifest.shots[0].provider, "chatgpt-web-image2");
    assert.equal(manifest.shots[0].assetType, "image");
    assert.equal(manifest.shots[0].storyboardAssetType, "video");
    assert.match(manifest.shots[0].suggestedEdit, /first frame/i);
    assert.equal(manifest.shots[3].provider, "dreamina-image");
    assert.match(manifest.shots[0].assetPath, /^03_key_images_chatgpt\//);
    assert.match(manifest.shots[3].assetPath, /^04_bulk_images_dreamina\//);

    const reviewLog = await readFile(path.join(result.packageDir, "07_review_log/prompt_iterations.jsonl"), "utf8");
    const reviewLines = reviewLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(reviewLines[0].provider, "chatgpt-web-image2");
    assert.equal(reviewLines[3].provider, "dreamina-image");
    assert.ok(reviewLines.every((line) => line.status === "accepted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider generation prompts omit shot labels and forbid panels or text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-generation-prompt-"));
  const generatedPrompts = [];
  try {
    await generateAssetPackage({
      script,
      outputRoot: root,
      slug: "provider-safe-prompt",
      mode: "test",
      provider: "dreamina-image",
      imageOnly: true,
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        dreaminaImage: {
          async generate({ packageDir, prompt, folder, attempt }) {
            generatedPrompts.push(prompt.generationPrompt);
            return fakeImageProvider("dreamina-image", []).generate({ packageDir, prompt, folder, attempt });
          }
        }
      }
    });

    assert.equal(generatedPrompts.length, 20);
    assert.ok(generatedPrompts.every((prompt) => !/Shot S\d{3}/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/\bCamera:/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => /单幅完整画面/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => /不要出现任何文字/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => /不要多格画面/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/漫画/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/字幕/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/气泡/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/对白/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/封面/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/海报/.test(prompt)));
    assert.ok(generatedPrompts.every((prompt) => !/[A-Za-z0-9]/.test(prompt)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider failures are logged and do not stop remaining shots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-provider-failure-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script,
      outputRoot: root,
      slug: "provider-failure",
      mode: "test",
      provider: "dreamina-image",
      imageOnly: true,
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        dreaminaImage: {
          async generate(args) {
            calls.push(args.prompt.shotId);
            if (args.prompt.shotId === "S004") {
              throw new Error("simulated provider outage");
            }
            return fakeImageProvider("dreamina-image", []).generate(args);
          }
        }
      }
    });

    assert.equal(result.summary.manualReview, 1);
    assert.equal(calls.filter((shotId) => shotId === "S004").length, 3);

    const manifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    assert.equal(manifest.shots.length, 19);
    assert.ok(!manifest.shots.some((shot) => shot.shotId === "S004"));

    const needsManualReview = JSON.parse(
      await readFile(path.join(result.packageDir, "07_review_log/needs_manual_review.json"), "utf8")
    );
    assert.equal(needsManualReview[0].shotId, "S004");
    assert.match(needsManualReview[0].reason, /provider_error/i);
    assert.match(needsManualReview[0].generationPrompt, /单幅完整画面/);

    const reviewLog = await readFile(path.join(result.packageDir, "07_review_log/prompt_iterations.jsonl"), "utf8");
    const reviewLines = reviewLog.trim().split("\n").map((line) => JSON.parse(line));
    const failedLines = reviewLines.filter((line) => line.shotId === "S004");
    assert.equal(failedLines.length, 3);
    assert.ok(failedLines.every((line) => line.status === "rejected"));
    assert.ok(failedLines.every((line) => /provider_error/i.test(line.issue)));
    assert.ok(failedLines.every((line) => line.provider === "dreamina-image"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakeImageProvider(provider, calls) {
  return {
    async generate({ packageDir, prompt, folder, attempt }) {
      calls.push({ provider, shotId: prompt.shotId, attempt });
      const filename = `${prompt.shotId}_${provider}_a${attempt}.png`;
      const relativePath = path.join(folder, filename).replaceAll("\\", "/");
      const absolutePath = path.join(packageDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, Buffer.from("fake png bytes"));
      return {
        shotId: prompt.shotId,
        assetType: "image",
        provider,
        relativePath,
        absolutePath,
        metadata: { generatedBy: provider }
      };
    }
  };
}
