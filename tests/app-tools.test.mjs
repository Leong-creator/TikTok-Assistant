import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareProviderTasks,
  saveFullPlan,
  startScriptWorkflow,
  startProductionRun,
  syncAssetsAndFinalize
} from "../src/app-tools.mjs";

const sampleScript = `
A young man received a huge settlement and moved into a luxury hotel.
He lived on interest while his principal stayed untouched.
Then his billionaire father taught him how relationships create money.
This story teaches children real-world financial judgment.
`;

test("startScriptWorkflow starts an operator workflow from only a script", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-simple-"));
  try {
    const result = await startScriptWorkflow({
      script: sampleScript,
      outputRoot: root,
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    assert.equal(result.status, "已开始制作");
    assert.match(result.message, /脚本/);
    assert.equal(result.videoGeneration, "manual-dreamina-image-to-video");
    assert.equal(result.operatorSummary["当前动作"], "首段钩子预检");
    assert.equal(result.operatorSummary["覆盖范围"], "前 30 秒到 1 分钟");
    assert.match(result.operatorSummary["本地任务"], /ChatGPT 首帧图任务和即梦图生视频任务/);
    assert.equal(result.workflowSummary["脚本状态"], "已保存");
    assert.equal(result.workflowSummary["素材生成"], "未自动触发");
    assert.match(result.workflowSummary["视频生成"], /即梦图生视频/);
    assert.equal(result.workflowSummary["数量规则"], "按脚本结构分段决定，不固定每轮 10 张");
    assert.equal(result.summary?.browserSupervisionPolicy, undefined);
    assert.ok(result.packageDir.startsWith(root));
    assert.doesNotMatch(JSON.stringify(result), /provider|slug|storyCategory|productCategory|mode|totalShots|keyImages|batchImages/);

    const original = await readFile(path.join(result.packageDir, "00_script/original.txt"), "utf8");
    assert.match(original, /huge settlement/);
    const providerManifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/provider_task_manifest.json"), "utf8")
    );
    assert.equal(providerManifest.imageOnly, true);
    assert.equal(providerManifest.videoGeneration, "manual-dreamina-image-to-video");
    assert.ok(providerManifest.dreaminaImageToVideoTasks > 0);

    const editingManifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    assert.equal(editingManifest.storyCategory, "make_money");
    assert.equal(editingManifest.productCategory, "raise_children");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startScriptWorkflow combines optional product name with script opening to avoid generic package names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-slug-"));
  try {
    const result = await startScriptWorkflow({
      script: sampleScript,
      productName: "Parenting Book",
      outputRoot: root,
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    assert.match(path.basename(result.packageDir), /chatgpt-parenting-book-a-young-man-received-a-huge/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startProductionRun creates a Chinese app run context without generating provider assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-start-"));
  try {
    const result = await startProductionRun({
      script: sampleScript,
      outputRoot: root,
      slug: "app-start",
      mode: "calibration",
      storyCategory: "make_money",
      productCategory: "raise_children",
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    assert.equal(path.basename(result.packageDir), "2026-05-10-app-start");
    assert.equal(result.status, "已创建生产上下文");
    assert.equal(result.defaults.provider, "mock");
    assert.equal(result.defaults.imageOnly, true);
    assert.equal(result.defaults.videoGeneration, "manual-dreamina-image-to-video");
    assert.ok(result.playbookLessons.some((lesson) => /不改原文拆镜/.test(lesson)));
    assert.ok(result.playbookLessons.some((lesson) => /首段钩子预检/.test(lesson)));
    assert.ok(result.playbookLessons.some((lesson) => /TikTok 监控方案/.test(lesson)));

    const original = await readFile(path.join(result.packageDir, "00_script/original.txt"), "utf8");
    assert.match(original, /huge settlement/);
    const appRun = JSON.parse(await readFile(path.join(result.packageDir, "07_review_log/app_run.json"), "utf8"));
    assert.equal(appRun.browserSupervisionPolicy.id, "persistent-browser-split-runtime-v1");
    assert.ok(appRun.browserSupervisionPolicy.appliesTo.includes("tiktok-monitoring"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveFullPlan persists GPT storyboard, prompts, style, characters, and review rubric", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-plan-"));
  try {
    const started = await startProductionRun({
      script: sampleScript,
      outputRoot: root,
      slug: "app-plan",
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    const result = await saveFullPlan({
      packageDir: started.packageDir,
      storyboard: [{ shotId: "S001", line: "hook", subjectType: "person_and_object" }],
      prompts: [{ shotId: "S001", imagePrompt: "Create one image now.", videoPrompt: "Animate this image." }],
      characterBible: { lead: "adult American business-story lead" },
      styleProfile: { id: "bright-comic-story-ad", ratio: "9:16" },
      reviewRubric: { reject: ["多格画面", "人物看镜头", "底部空白"] }
    });

    assert.equal(result.status, "已保存完整生产计划");
    assert.equal(result.counts.storyboard, 1);
    assert.equal(result.counts.prompts, 1);
    const savedStyle = JSON.parse(await readFile(path.join(started.packageDir, "02_prompts/style_profile.json"), "utf8"));
    assert.equal(savedStyle.id, "bright-comic-story-ad");
    const checkpoint = await readFile(path.join(started.packageDir, "07_review_log/app_tool_checkpoints.jsonl"), "utf8");
    assert.match(checkpoint, /save_full_plan/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepareProviderTasks reuses the existing pipeline and writes ChatGPT image plus Dreamina video tasks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-tasks-"));
  try {
    const result = await prepareProviderTasks({
      script: sampleScript,
      outputRoot: root,
      slug: "app-provider-tasks",
      mode: "calibration",
      provider: "image-mvp",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      conversionAngle: "use a money story to sell children real-world judgment and financial literacy",
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    assert.equal(result.status, "已准备 ChatGPT 生图和即梦图生视频任务");
    assert.equal(result.summary.totalShots, 12);
    assert.equal(result.summary.chatgptImageShots, 12);
    assert.equal(result.summary.dreaminaImageShots, 0);
    assert.equal(result.summary.dreaminaVideoShots, 8);
    assert.equal(result.taskCounts.chatgptWebImage2, 12);
    assert.equal(result.taskCounts.dreaminaImage, 0);
    assert.equal(result.taskCounts.dreaminaImageToVideo, 8);
    assert.equal(result.videoGeneration, "manual-dreamina-image-to-video");

    const chatgptTask = JSON.parse(
      await readFile(path.join(result.packageDir, "07_review_log/chatgpt_web_tasks/S001_a1.json"), "utf8")
    );
    assert.equal(chatgptTask.provider, "chatgpt-web-image2");
    assert.match(chatgptTask.prompt, /^Create one image now\./);
    assert.match(chatgptTask.prompt, /first frame for image-to-video/);
    assert.equal(chatgptTask.imageRole, "dreamina_video_first_frame");
    assert.equal(chatgptTask.generatedAssetType, "image");
    assert.equal(chatgptTask.browserSupervisionPolicy.id, "persistent-browser-split-runtime-v1");
    assert.equal(chatgptTask.browserSupervisionPolicy.operationMode, "openclaw-profile-clone-with-split-visibility");
    assert.ok(chatgptTask.browserSupervisionPolicy.appliesTo.includes("tiktok-monitoring"));

    const dreaminaTasks = JSON.parse(
      await readFile(path.join(result.packageDir, "07_review_log/dreamina_image_tasks.json"), "utf8")
    );
    assert.equal(dreaminaTasks.status, "fallback-only");
    assert.equal(dreaminaTasks.tasks.length, 0);

    const dreaminaVideoTasks = JSON.parse(
      await readFile(path.join(result.packageDir, "07_review_log/dreamina_image_to_video_tasks.json"), "utf8")
    );
    assert.equal(dreaminaVideoTasks.execution, "manual");
    assert.equal(dreaminaVideoTasks.tasks.length, 8);
    assert.match(dreaminaVideoTasks.tasks[0].prompt, /根据上传的首帧图生成一个竖版短视频片段/);
    assert.match(dreaminaVideoTasks.tasks[0].prompt, /镜头运动/);
    assert.match(dreaminaVideoTasks.tasks[0].prompt, /结尾状态/);

    const providerManifest = JSON.parse(
      await readFile(path.join(result.packageDir, "06_editing_package/provider_task_manifest.json"), "utf8")
    );
    assert.equal(providerManifest.provider, "image-mvp");
    assert.equal(providerManifest.imageOnly, true);
    assert.equal(providerManifest.videoGeneration, "manual-dreamina-image-to-video");
    assert.equal(providerManifest.browserSupervisionPolicy.tiktokMonitoring.mode, "headless-persistent-session");
    assert.equal(providerManifest.routes.length, 12);
    assert.equal(providerManifest.dreaminaImageToVideoTasks, 8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncAssetsAndFinalize imports accepted files and updates manifest plus review logs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tk-app-sync-"));
  try {
    const prepared = await prepareProviderTasks({
      script: sampleScript,
      outputRoot: root,
      slug: "app-sync",
      mode: "calibration",
      provider: "image-mvp",
      imageOnly: true,
      storyCategory: "make_money",
      productCategory: "raise_children",
      now: new Date("2026-05-10T00:00:00+08:00")
    });

    const downloads = path.join(root, "Downloads");
    await mkdir(downloads, { recursive: true });
    const source = path.join(downloads, "accepted.png");
    await writeFile(source, "fake image bytes");

    const result = await syncAssetsAndFinalize({
      packageDir: prepared.packageDir,
      acceptedFiles: [
        {
          shotId: "S001",
          provider: "chatgpt-web-image2",
          attempt: 2,
          sourcePath: source
        }
      ],
      reviewEntries: [
        {
          shotId: "S001",
          provider: "chatgpt-web-image2",
          status: "accepted",
          notes: "页面内审核通过：现金冲击和人物反应清楚"
        }
      ]
    });

    assert.equal(result.status, "已同步素材并完成收尾");
    assert.equal(result.imported.length, 1);
    assert.match(result.imported[0].assetPath, /03_key_images_chatgpt\/S001_chatgpt-web-image2_a2\.png$/);

    const manifest = JSON.parse(
      await readFile(path.join(prepared.packageDir, "06_editing_package/editing_manifest.json"), "utf8")
    );
    const shot = manifest.shots.find((item) => item.shotId === "S001");
    assert.equal(shot.provider, "chatgpt-web-image2");
    assert.equal(shot.attempts, 2);

    const visualReview = await readFile(path.join(prepared.packageDir, "07_review_log/visual_review.jsonl"), "utf8");
    assert.match(visualReview, /页面内审核通过/);
    const checkpoint = await readFile(path.join(prepared.packageDir, "07_review_log/app_tool_checkpoints.jsonl"), "utf8");
    assert.match(checkpoint, /sync_assets_and_finalize/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
