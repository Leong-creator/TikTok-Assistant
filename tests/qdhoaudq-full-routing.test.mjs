import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateAssetPackage, retryPackageShots } from "../src/pipeline.mjs";

const qdhoaudqScript = await readFile(new URL("../fixtures/qdhoaudq-43k-script.txt", import.meta.url), "utf8");

test("qdhoaudq full package supports business story plus raise-children product metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-qdhoaudq-meta-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script: qdhoaudqScript,
      outputRoot: root,
      slug: "qdhoaudq-43k-make-money",
      mode: "full",
      provider: "image-mvp",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      conversionAngle: "use a money story to sell children real-world judgment and financial literacy",
      routingPlan: "qdhoaudq-43k",
      totalShots: 80,
      videoShots: 24,
      chatgptImageCount: 30,
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        chatgptWebImage2: fakeImageProvider("chatgpt-web-image2", calls),
        dreaminaImage: fakeImageProvider("dreamina-image", calls)
      }
    });

    assert.equal(result.summary.totalShots, 80);
    assert.equal(result.summary.videoShots, 24);
    assert.equal(result.summary.chatgptImageShots, 30);
    assert.equal(result.summary.dreaminaImageShots, 50);
    assert.equal(result.summary.dreaminaVideoShots, 24);
    assert.equal(result.summary.storyCategory, "make_money");
    assert.equal(result.summary.productCategory, "raise_children");
    assert.equal(calls.filter((call) => call.provider === "chatgpt-web-image2").length, 30);
    assert.equal(calls.filter((call) => call.provider === "dreamina-image").length, 50);

    const manifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    assert.equal(manifest.storyCategory, "make_money");
    assert.equal(manifest.productCategory, "raise_children");
    assert.equal(manifest.conversionAngle, "use a money story to sell children real-world judgment and financial literacy");
    assert.equal(manifest.shots.length, 80);
    assert.equal(manifest.shots.filter((shot) => shot.provider === "chatgpt-web-image2").length, 30);
    assert.equal(manifest.shots.filter((shot) => shot.provider === "dreamina-image").length, 50);
    assert.equal(manifest.shots.filter((shot) => shot.storyboardAssetType === "video").length, 24);
    assert.ok(manifest.shots.filter((shot) => shot.storyboardAssetType === "video").every((shot) => /即梦图生视频首帧/.test(shot.suggestedEdit)));

    const storyboard = JSON.parse(
      await readFile(path.join(result.packageDir, "01_storyboard/storyboard.json"), "utf8")
    );
    assert.equal(storyboard[0].storyCategory, "make_money");
    assert.equal(storyboard[0].productCategory, "raise_children");
    assert.ok(storyboard.slice(0, 64).every((shot) => !["conversion_video", "book_broll"].includes(shot.section)));
    assert.ok(storyboard.slice(0, 12).every((shot) => shot.section === "hook_video"));
    assert.ok(storyboard.slice(64, 76).every((shot) => shot.section === "conversion_video"));
    assert.ok(storyboard.slice(-4).every((shot) => shot.section === "book_broll"));

    const prompts = JSON.parse(await readFile(path.join(result.packageDir, "02_prompts/prompts.json"), "utf8"));
    assert.ok(prompts.slice(0, 24).every((prompt) => prompt.videoPrompt));
    assert.ok(prompts.filter((prompt) => prompt.assetType === "video").every((prompt) => /根据上传的首帧图生成一个竖版短视频片段/.test(prompt.dreaminaVideoPrompt)));
    assert.ok(prompts.slice(0, 12).every((prompt) => prompt.chatgptBatchPolicy.recommendedBatchSize === "2-4"));
    assert.ok(prompts.slice(12, 64).every((prompt) => prompt.chatgptBatchPolicy.recommendedBatchSize === "6-12"));
    assert.ok(prompts.slice(-4).every((prompt) => prompt.operatorSectionName === "图书空镜"));
    assert.ok(prompts.every((prompt) => !/caption space|clean center space|lower-third/i.test(prompt.imagePrompt)));
    assert.ok(prompts.every((prompt) => !/底部.*负空间|预留.*字幕|大面积空白/.test(prompt.generationPrompt)));
    assert.ok(prompts.every((prompt) => /不要上下分屏/.test(prompt.generationPrompt)));
    assert.ok(prompts.every((prompt) => /不要画中画/.test(prompt.generationPrompt)));
    assert.ok(prompts.slice(0, 64).some((prompt) => /hotel|Ferrari|real estate|commission/i.test(prompt.imagePrompt)));
    assert.match(prompts[0].imagePrompt, /scroll-stopping money hook|flying cash|shocked bystanders|money-status contrast/i);
    assert.match(prompts[0].generationPrompt, /现金雨|震惊围观|财富冲击|身份反差/);
    for (const prompt of prompts.slice(0, 3)) {
      assert.match(prompt.imagePrompt, /cash rain|flying cash|shocked bystanders|wealth shock|money-status contrast|visible money shock/i);
      assert.match(prompt.generationPrompt, /现金雨|飞舞现金|震惊围观|财富冲击|强烈金钱钩子|身份反差/);
    }
    const referralPrompt = prompts.find((prompt) => /brought friends to buy cars|half his commission plus small gifts/i.test(prompt.line));
    assert.ok(referralPrompt);
    assert.match(referralPrompt.generationPrompt, /两位朋友|三位买家|朋友清楚可见/);
    assert.match(referralPrompt.generationPrompt, /单一镜头|人物只出现一次/);
    assert.match(referralPrompt.generationPrompt, /转介绍|递上礼物/);
    assert.doesNotMatch(referralPrompt.generationPrompt, /一辆亮眼红色跑车占据视觉中心/);
    const mercedesPrompt = prompts.find((prompt) => /brother in law saw the new Ferrari|used Mercedes/i.test(prompt.line));
    assert.ok(mercedesPrompt);
    assert.match(mercedesPrompt.generationPrompt, /家庭车库|豪华旧车|亲戚|车价/);
    assert.ok(prompts.slice(-8).every((prompt) => /children|parent|financial literacy|real-world judgment/i.test(prompt.imagePrompt)));
    assert.ok(prompts.slice(0, 64).every((prompt) => !/家庭冲突|普通家庭住宅/.test(prompt.generationPrompt)));
    assert.ok(prompts.slice(0, 64).some((prompt) => /豪华酒店|房产公司|豪车展厅/.test(prompt.generationPrompt)));
    assert.ok(prompts.slice(-8).every((prompt) => /亲子财商教育|现实判断/.test(prompt.generationPrompt)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("routing counts are per run and not fixed to qdhoaudq values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-variable-counts-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script: "A short business lesson starts in a small shop and ends with parents teaching children money judgment.",
      outputRoot: root,
      slug: "short-variable-plan",
      provider: "image-mvp",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      totalShots: 12,
      videoShots: 4,
      chatgptImageCount: 5,
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        chatgptWebImage2: fakeImageProvider("chatgpt-web-image2", calls),
        dreaminaImage: fakeImageProvider("dreamina-image", calls)
      }
    });

    assert.equal(result.summary.totalShots, 12);
    assert.equal(result.summary.videoShots, 4);
    assert.equal(result.summary.chatgptImageShots, 5);
    assert.equal(result.summary.dreaminaImageShots, 7);
    assert.equal(calls.filter((call) => call.provider === "chatgpt-web-image2").length, 5);
    assert.equal(calls.filter((call) => call.provider === "dreamina-image").length, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("qdhoaudq script is cleaned from transcript fragments into story sentences", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-qdhoaudq-clean-"));
  try {
    const result = await generateAssetPackage({
      script: qdhoaudqScript,
      outputRoot: root,
      slug: "qdhoaudq-cleaning",
      mode: "full",
      provider: "mock",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    const cleaned = await readFile(path.join(result.packageDir, "00_script/cleaned_script.txt"), "utf8");
    const cleanedLines = cleaned.trim().split("\n");
    assert.ok(cleanedLines.length < qdhoaudqScript.trim().split("\n").length / 2);
    assert.match(cleanedLines[0], /California received a 20 million dollar settlement/i);
    assert.match(cleaned, /Ferrari dealership/i);
    assert.match(cleaned, /billionaire father/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("qdhoaudq retry does not apply unrelated parenting shot fixes to business Ferrari scenes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-qdhoaudq-retry-business-"));
  const calls = [];
  try {
    const result = await generateAssetPackage({
      script: qdhoaudqScript,
      outputRoot: root,
      slug: "qdhoaudq-retry-business",
      mode: "full",
      provider: "mock",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      now: new Date("2026-05-09T00:00:00+08:00")
    });

    await retryPackageShots({
      packageDir: result.packageDir,
      shots: ["S015", "S016"],
      provider: "dreamina-image",
      now: new Date("2026-05-09T00:00:00+08:00"),
      providerAdapters: {
        dreaminaImage: fakeImageProvider("dreamina-image", calls)
      }
    });

    const prompts = JSON.parse(await readFile(path.join(result.packageDir, "02_prompts/prompts.json"), "utf8"));
    const retried = prompts.filter((prompt) => ["S015", "S016"].includes(prompt.shotId));
    assert.ok(retried.every((prompt) => /豪车展厅|富有女性|销售员|跑车/.test(prompt.generationPrompt)));
    assert.ok(retried.every((prompt) => !/家庭客厅|家庭空间|拎包停在门口/.test(prompt.generationPrompt)));
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
