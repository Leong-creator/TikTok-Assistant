import { appendFile, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectDownloadedImages, applyCollectedImagesToManifest } from "./download-collector.mjs";
import { upsertPackageIndex } from "./package-index.mjs";
import { generateAssetPackage } from "./pipeline.mjs";
import { browserSupervisionPolicySummary } from "./browser-supervision-policy.mjs";

const MODE_DEFAULTS = {
  calibration: { totalShots: 12, videoShots: 8, chatgptImageCount: 12 },
  pilot: { totalShots: 28, videoShots: 12, chatgptImageCount: 20 },
  test: { totalShots: 20, videoShots: 8, chatgptImageCount: 20 },
  standard: { totalShots: 40, videoShots: 14, chatgptImageCount: 32 },
  full: { totalShots: 80, videoShots: 24, chatgptImageCount: 48 }
};

export const TIKTOK_PRODUCER_GOAL =
  "Build the GPT-first TikTok素材制作助手 MVP where ChatGPT handles script understanding, Chinese 钩子 review, segmented storyboards, first-frame images, visual review, and prompt iteration. The local App is retained only for developer packaging experiments and must not be used as the current operator entry. Dreamina is planned primarily for manual image-to-video tasks from approved ChatGPT first-frame images; no paid generation runs without explicit confirmation.";

export const DEFAULT_PLAYBOOK_LESSONS = [
  "不改原文拆镜，短句只在逻辑相关时合并，节奏适配 2-4 秒。",
  "先识别脚本结构：前段视频、中段图片、后段部分视频加图书空镜，再生成单镜头 prompt。",
  "页面和运营输出统一使用中文“钩子”“首段钩子”“钩子强度”，不要用 hook。",
  "ChatGPT 生图 prompt 必须以 Create one image now. 或 Create N separate images now. 开头。",
  "ChatGPT 是主要生图工具；前段首帧每批 2-4 张，中段图片每批 6-12 张，后段转化和图书空镜每批 3-6 张。",
  "首段钩子预检覆盖前 30 秒到 1 分钟，默认 6-12 个关键镜头，质量优先。",
  "视频镜头的 ChatGPT 图片必须按图生视频首帧写：人物姿态、空间方向、情绪变化和镜头运动都要可延展。",
  "ChatGPT 生图前必须显式选择图片生成工具；普通聊天回复分析文字视为 provider 失败。",
  "人物默认不要直视镜头，除非脚本明确需要对镜头表达。",
  "所有输出 9:16 竖图、单幅完整画面、无文字、无多格、无底部空白。",
  "商业/金钱开头优先现金雨、身份反差、震惊反应、合同、佣金、豪车和富人场景。",
  "即梦第一版重点做图生视频，不承担主要生图；即梦视频 prompt 必须描述脚本意图、首帧承接、动作变化、镜头运动、情绪变化、场景动态、时长和结尾状态。",
  "生成后先审核钩子强度、风格、主体、构图和场景逻辑，再下载或导入。",
  "浏览器默认采用 persistent Chrome 方案：TikTok 监控走 headless run profile，ChatGPT 生图/审图/下载走 headed run profile，两者共用同一 source profile。",
  "TikTok 监控方案和 ChatGPT 生图方案现在共享同一套 persistent browser 基础设施，只是可见性模式不同。",
  "ChatGPT 生图和下载不再默认依赖 Codex Chrome 插件；如果 persistent browser 出问题，先按 OpenClaw 的 profile clone 方案排查。"
];

export async function startScriptWorkflow(options) {
  const script = String(options?.script ?? "").trim();
  if (!script) throw new Error("script is required");
  const productName = String(options.productName ?? "").trim();
  const notes = String(options.notes ?? "").trim();
  const mode = chooseAutomaticMode(script);
  const result = await prepareProviderTasks({
    script,
    outputRoot: options.outputRoot,
    slug: buildAutomaticSlug(script, productName),
    mode,
    provider: "image-mvp",
    imageOnly: true,
    storyCategory: inferStoryCategory(script),
    productCategory: inferProductCategory(productName, script),
    conversionAngle: notes,
    now: options.now
  });

  return {
    status: "已开始制作",
    message:
      "已收到脚本并准备首段钩子预检包。请先审核前 30 秒到 1 分钟的关键首帧和即梦图生视频任务，再决定是否继续全量。",
    packageDir: result.packageDir,
    operatorSummary: {
      当前动作: "首段钩子预检",
      覆盖范围: "前 30 秒到 1 分钟",
      本地任务: "已准备 ChatGPT 首帧图任务和即梦图生视频任务清单",
      本地包目录: result.packageDir,
      下一步: "先看钩子强度和视频首帧可动性；确认后回复“继续全量”。"
    },
    workflowSummary: {
      脚本状态: "已保存",
      素材生成: "未自动触发",
      视频生成: "需人工把 ChatGPT 首帧图交给即梦图生视频",
      数量规则: "按脚本结构分段决定，不固定每轮 10 张"
    },
    videoGeneration: "manual-dreamina-image-to-video",
    nextAction: "先完成首段钩子预检：ChatGPT 生成并审核首帧图；通过后人工复制即梦图生视频 prompt。确认后再继续全量。"
  };
}

export async function startProductionRun(options) {
  const config = normalizeAppOptions(options);
  const packageDir = path.join(config.outputRoot, `${formatLocalDate(config.now)}-${config.slug}`);
  await createPackageDirectories(packageDir);
  await writeText(path.join(packageDir, "00_script/original.txt"), config.script.trim() + "\n");
  await writeJson(path.join(packageDir, "07_review_log/app_run.json"), {
    goal: TIKTOK_PRODUCER_GOAL,
    createdAt: config.now.toISOString(),
    mode: config.mode,
    storyCategory: config.storyCategory,
    productCategory: config.productCategory,
    conversionAngle: config.conversionAngle,
    defaults: buildDefaults(config),
    browserSupervisionPolicy: browserSupervisionPolicySummary(),
    playbookLessons: DEFAULT_PLAYBOOK_LESSONS
  });
  await recordAppCheckpoint(packageDir, "start_production_run", {
    mode: config.mode,
    slug: config.slug,
    scriptCharacters: config.script.trim().length
  });

  return {
    status: "已创建生产上下文",
    packageDir,
    goal: TIKTOK_PRODUCER_GOAL,
    defaults: buildDefaults(config),
    playbookLessons: DEFAULT_PLAYBOOK_LESSONS,
    nextStep: "请让 GPT 先输出首段钩子预检，再基于 playbook 生成分镜、人物设定、风格设定、ChatGPT 生图 prompt 和即梦图生视频 prompt。"
  };
}

export async function saveFullPlan(options) {
  const packageDir = requiredPath(options.packageDir, "packageDir");
  const storyboard = options.storyboard ?? [];
  const prompts = options.prompts ?? [];
  await writeJson(path.join(packageDir, "01_storyboard/gpt_storyboard.json"), storyboard);
  await writeJson(path.join(packageDir, "02_prompts/gpt_prompts.json"), prompts);
  await writeJson(path.join(packageDir, "02_prompts/character_bible.json"), options.characterBible ?? {});
  await writeJson(path.join(packageDir, "02_prompts/style_profile.json"), options.styleProfile ?? {});
  await writeJson(path.join(packageDir, "07_review_log/review_rubric.json"), options.reviewRubric ?? {});
  await recordAppCheckpoint(packageDir, "save_full_plan", {
    storyboard: storyboard.length,
    prompts: prompts.length
  });

  return {
    status: "已保存完整生产计划",
    packageDir,
    counts: {
      storyboard: storyboard.length,
      prompts: prompts.length
    },
    nextStep: "请调用 prepare_provider_tasks，把计划转成 ChatGPT 生图任务和即梦图生视频人工任务。"
  };
}

export async function prepareProviderTasks(options) {
  const config = normalizeAppOptions({
    ...options,
    provider: options.provider ?? "image-mvp",
    imageOnly: options.imageOnly ?? true
  });
  const generated = options.packageDir
    ? { packageDir: path.resolve(options.packageDir), summary: await summarizeExistingPackage(options.packageDir, config) }
    : await generateAssetPackage({
        script: config.script,
        outputRoot: config.outputRoot,
        slug: config.slug,
        mode: config.mode,
        provider: "mock",
        imageOnly: true,
        keyImageCount: config.keyImageCount,
        totalShots: config.totalShots,
        videoShots: config.videoShots,
        chatgptImageCount: config.chatgptImageCount,
        routingPlan: config.routingPlan,
        storyCategory: config.storyCategory,
        productCategory: config.productCategory,
        conversionAngle: config.conversionAngle,
        now: config.now,
        language: config.language,
        region: config.region
      });

  const prompts = JSON.parse(await readFile(path.join(generated.packageDir, "02_prompts/prompts.json"), "utf8"));
  const routes = buildProviderRoutes(prompts, config);
  await writeProviderTaskFiles({ packageDir: generated.packageDir, prompts, routes, config });
  await recordAppCheckpoint(generated.packageDir, "prepare_provider_tasks", {
    provider: config.provider,
    imageOnly: true,
    chatgptWebImage2: routes.filter((route) => route.provider === "chatgpt-web-image2").length,
    dreaminaImage: routes.filter((route) => route.provider === "dreamina-image").length,
    dreaminaImageToVideo: prompts.filter((prompt) => prompt.assetType === "video").length
  });
  const taskCounts = {
    chatgptWebImage2: routes.filter((route) => route.provider === "chatgpt-web-image2").length,
    dreaminaImage: routes.filter((route) => route.provider === "dreamina-image").length,
    dreaminaImageToVideo: prompts.filter((prompt) => prompt.assetType === "video").length,
    mock: routes.filter((route) => route.provider === "mock").length
  };

  return {
    status: "已准备 ChatGPT 生图和即梦图生视频任务",
    packageDir: generated.packageDir,
    summary: {
      ...generated.summary,
      provider: config.provider,
      chatgptImageShots: taskCounts.chatgptWebImage2,
      dreaminaImageShots: taskCounts.dreaminaImage,
      dreaminaVideoShots: taskCounts.dreaminaImageToVideo
    },
    taskCounts,
    videoGeneration: "manual-dreamina-image-to-video",
    browserSupervisionPolicy: browserSupervisionPolicySummary(),
    nextStep: "ChatGPT 先生成并审核首帧图和叙事图片；通过的首帧图再人工交给即梦图生视频。即梦生图默认不执行。"
  };
}

export async function syncAssetsAndFinalize(options) {
  const packageDir = requiredPath(options.packageDir, "packageDir");
  const imported = [];
  const moved = [];

  for (const item of options.acceptedFiles ?? []) {
    const move = await importAcceptedFile(packageDir, item);
    moved.push(move);
    imported.push({
      shotId: move.shotId,
      provider: move.provider,
      attempt: move.attempt,
      assetPath: path.relative(packageDir, move.to).replaceAll("\\", "/")
    });
  }

  if (options.downloadCollection) {
    const collected = await collectDownloadedImages({
      downloadDir: requiredPath(options.downloadCollection.downloadDir, "downloadCollection.downloadDir"),
      beforeSnapshot: new Set(options.downloadCollection.beforeSnapshot ?? []),
      packageDir,
      folder: options.downloadCollection.folder ?? "03_key_images_chatgpt",
      assignments: options.downloadCollection.assignments ?? [],
      logPath: path.join(packageDir, "07_review_log/download_moves.jsonl")
    });
    moved.push(...collected);
    imported.push(
      ...collected.map((item) => ({
        shotId: item.shotId,
        provider: item.provider,
        attempt: item.attempt,
        assetPath: path.relative(packageDir, item.to).replaceAll("\\", "/")
      }))
    );
  }

  if (moved.length > 0) {
    await applyCollectedImagesToManifest({ packageDir, moved });
  }
  await appendJsonLines(path.join(packageDir, "07_review_log/visual_review.jsonl"), options.reviewEntries ?? []);
  await recordAppCheckpoint(packageDir, "sync_assets_and_finalize", {
    imported: imported.length,
    reviewEntries: (options.reviewEntries ?? []).length
  });
  await refreshPackageIndex(packageDir);

  return {
    status: "已同步素材并完成收尾",
    packageDir,
    imported,
    reviewEntries: (options.reviewEntries ?? []).length
  };
}

function normalizeAppOptions(options = {}) {
  const mode = options.mode ?? "test";
  const modeDefaults = MODE_DEFAULTS[mode];
  if (!modeDefaults) throw new Error(`unsupported mode: ${mode}`);
  const script = String(options.script ?? "").trim();
  if (!script && !options.packageDir) throw new Error("script is required unless packageDir is provided");
  const totalShots = Math.trunc(Number(options.totalShots ?? modeDefaults.totalShots));
  const videoShots = Math.min(Math.trunc(Number(options.videoShots ?? modeDefaults.videoShots)), totalShots);
  const chatgptImageCount = Math.min(
    Math.trunc(Number(options.chatgptImageCount ?? options.keyImageCount ?? modeDefaults.chatgptImageCount)),
    totalShots
  );
  return {
    script,
    outputRoot: path.resolve(options.outputRoot ?? "outputs"),
    slug: slugify(options.slug ?? "tiktok-producer-run"),
    mode,
    provider: options.provider ?? "mock",
    imageOnly: options.imageOnly ?? true,
    keyImageCount: Number(options.keyImageCount ?? 3),
    totalShots,
    videoShots,
    chatgptImageCount,
    routingPlan: options.routingPlan,
    storyCategory: options.storyCategory,
    productCategory: options.productCategory ?? options.storyCategory,
    conversionAngle: options.conversionAngle ?? "",
    language: options.language ?? "en-US",
    region: options.region ?? "United States",
    now: options.now ?? new Date(),
    dreamina: {
      modelVersion: options.dreamina?.modelVersion ?? "4.0",
      resolutionType: options.dreamina?.resolutionType ?? "2k",
      ratio: options.dreamina?.ratio ?? "9:16",
      pollSeconds: Number(options.dreamina?.pollSeconds ?? 90),
      sessionId: options.dreamina?.sessionId
    }
  };
}

function chooseAutomaticMode(script) {
  void script;
  return "calibration";
}

function buildAutomaticSlug(script, productName) {
  const phrase = firstUsefulScriptPhrase(script);
  const source = [productName, phrase].filter(Boolean).join("-") || "chatgpt-script";
  return `chatgpt-${source}`;
}

function firstUsefulScriptPhrase(script) {
  const line = script
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.length >= 4);
  if (!line) return "";
  return line
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .slice(0, 6)
    .join("-");
}

function inferProductCategory(productName, script) {
  const text = `${productName} ${script}`.toLowerCase();
  if (!productName && !/(book|course|child|children|kid|parent|school|raise|family|teacher)/u.test(text)) return undefined;
  if (/(book|course|child|children|kid|parent|school|raise|family|teacher|教育|孩子|父母|亲子|书|课程)/u.test(text)) {
    return "raise_children";
  }
  return undefined;
}

function inferStoryCategory(script) {
  const text = script.toLowerCase();
  if (
    /(settlement|investment|interest|commission|profit|real estate|ferrari|dealership|cash|wealthy|billionaire|salary|sell houses|property prices|luxury car|mercedes|million|dollar)/u.test(
      text
    )
  ) {
    return "make_money";
  }
  if (/(child|children|kid|parent|school|teacher|family|mother|father|raise)/u.test(text)) {
    return "raise_children";
  }
  return undefined;
}

function buildDefaults(config) {
  return {
    provider: "mock",
    realProviderRoute: "image-mvp",
    imageOnly: true,
    videoGeneration: "manual-dreamina-image-to-video",
    mode: config.mode,
    totalShots: config.totalShots,
    videoShots: config.videoShots,
    chatgptImageCount: config.chatgptImageCount,
    storyCategory: config.storyCategory,
    productCategory: config.productCategory,
    browserSupervisionPolicy: browserSupervisionPolicySummary(),
    outputFolders: [
      "00_script",
      "01_storyboard",
      "02_prompts",
      "03_key_images_chatgpt",
      "04_bulk_images_dreamina",
      "05_video_clips_dreamina",
      "06_editing_package",
      "07_review_log"
    ]
  };
}

async function summarizeExistingPackage(packageDir, config) {
  const prompts = JSON.parse(await readFile(path.join(packageDir, "02_prompts/prompts.json"), "utf8"));
  return {
    mode: config.mode,
    provider: "mock",
    storyCategory: config.storyCategory,
    productCategory: config.productCategory,
    totalShots: prompts.length,
    videoShots: prompts.filter((prompt) => prompt.assetType === "video").length,
    imageShots: prompts.filter((prompt) => prompt.assetType !== "video").length,
    manualReview: 0
  };
}

function buildProviderRoutes(prompts, config) {
  return prompts.map((prompt) => {
    if (config.provider === "image-mvp") {
      return providerRoute(prompt, "chatgpt-web-image2");
    }
    if (config.provider === "chatgpt-web-image2") return providerRoute(prompt, "chatgpt-web-image2");
    if (config.provider === "dreamina-image") return providerRoute(prompt, "dreamina-image");
    return providerRoute(prompt, "mock");
  });
}

function providerRoute(prompt, provider) {
  const folder =
    provider === "chatgpt-web-image2"
      ? "03_key_images_chatgpt"
      : provider === "dreamina-image"
        ? "04_bulk_images_dreamina"
        : prompt.assetType === "video"
          ? "05_video_clips_dreamina"
          : "04_bulk_images_dreamina";
  return {
    shotId: prompt.shotId,
    order: prompt.order,
    provider,
    storyboardAssetType: prompt.assetType,
    generatedAssetType: "image",
    folder
  };
}

function buildChatGptShotIdSet(config) {
  const count = Math.min(config.chatgptImageCount, config.totalShots);
  const orders = new Set();
  const videoCount = Math.min(config.videoShots, count);
  for (let order = 1; order <= videoCount; order += 1) orders.add(order);
  const remaining = count - orders.size;
  if (remaining > 0) {
    for (const order of buildAnchorOrders(config.totalShots, config.videoShots, remaining, config.routingPlan)) {
      if (orders.size >= count) break;
      orders.add(order);
    }
  }
  for (let order = 1; orders.size < count && order <= config.totalShots; order += 1) orders.add(order);
  return new Set([...orders].map((order) => `S${String(order).padStart(3, "0")}`));
}

function buildAnchorOrders(totalShots, videoShots, count, routingPlan) {
  if (routingPlan === "qdhoaudq-43k") {
    const preferred = [25, 32, 40, 48, 56, 64, 73, 76, 80].filter((order) => order <= totalShots && order > videoShots);
    if (preferred.length >= count) return preferred;
  }
  const start = Math.min(totalShots, videoShots + 1);
  const span = Math.max(1, totalShots - start + 1);
  return [...new Set(Array.from({ length: count }, (_, index) => Math.min(totalShots, start + Math.floor((span * index) / count))))];
}

async function writeProviderTaskFiles({ packageDir, prompts, routes, config }) {
  const routeByShot = new Map(routes.map((route) => [route.shotId, route]));
  const chatgptDir = path.join(packageDir, "07_review_log/chatgpt_web_tasks");
  await mkdir(chatgptDir, { recursive: true });
  const browserSupervisionPolicy = browserSupervisionPolicySummary();
  await writeJson(path.join(packageDir, "07_review_log/chatgpt_session.json"), {
    provider: "chatgpt-web-image2",
    model: "image-2",
    conversationReuse: "one conversation per script",
    requiredBrowserStep: "先在 headed persistent ChatGPT 会话中显式选择图片生成工具，再发送 prompt",
    browserSupervisionPolicy,
    batchPolicy: {
      首段钩子首帧: "每批 2-4 张，质量优先",
      中段叙事图片: "每批 6-12 张，效率优先",
      后段转化和图书空镜: "每批 3-6 张，可信度优先"
    },
    status: "prepared-by-app"
  });

  const dreaminaTasks = [];
  for (const prompt of prompts) {
    const route = routeByShot.get(prompt.shotId);
    if (!route) continue;
    if (route.provider === "chatgpt-web-image2") {
      await writeJson(path.join(chatgptDir, `${prompt.shotId}_a1.json`), {
        provider: "chatgpt-web-image2",
        model: "image-2",
        shotId: prompt.shotId,
        attempt: 1,
        outputFolder: route.folder,
        generatedAssetType: "image",
        storyboardAssetType: prompt.assetType,
        imageRole: prompt.imageRole,
        operatorSectionName: prompt.operatorSectionName,
        chatgptBatchPolicy: prompt.chatgptBatchPolicy,
        requiredBrowserStep: "select ChatGPT image-generation tool in the headed persistent session first, then send prompt",
        browserSupervisionPolicy,
        prompt: prompt.imagePrompt,
        dreaminaVideoPrompt: prompt.dreaminaVideoPrompt
      });
    }
    if (route.provider === "dreamina-image") {
      dreaminaTasks.push({
        provider: "dreamina-image",
        shotId: prompt.shotId,
        attempt: 1,
        outputFolder: route.folder,
        generatedAssetType: "image",
        storyboardAssetType: prompt.assetType,
        prompt: prompt.generationPrompt ?? prompt.imagePrompt,
        command: buildDreaminaCommand(prompt.generationPrompt ?? prompt.imagePrompt, config.dreamina)
      });
    }
  }

  const dreaminaVideoTasks = prompts
    .filter((prompt) => prompt.assetType === "video")
    .map((prompt) => ({
      provider: "dreamina-image-to-video",
      shotId: prompt.shotId,
      outputFolder: "05_video_clips_dreamina",
      inputFirstFrameFolder: "03_key_images_chatgpt",
      inputFirstFrameNaming: `${prompt.shotId}_chatgpt-web-image2_a<accepted-attempt>.png`,
      operatorSectionName: prompt.operatorSectionName,
      imageRole: prompt.imageRole,
      prompt: prompt.dreaminaVideoPrompt,
      manualStep: "将审核通过的 ChatGPT 首帧图上传到即梦图生视频，并复制本 prompt。"
    }));

  await writeJson(path.join(packageDir, "07_review_log/dreamina_image_tasks.json"), {
    provider: "dreamina-image",
    status: "fallback-only",
    videoGeneration: "not-for-primary-mvp",
    requiresExplicitConfirmation: true,
    tasks: dreaminaTasks
  });
  await writeJson(path.join(packageDir, "07_review_log/dreamina_image_to_video_tasks.json"), {
    provider: "dreamina-image-to-video",
    execution: "manual",
    requiresApprovedChatGptFirstFrame: true,
    requiresExplicitConfirmation: true,
    tasks: dreaminaVideoTasks
  });
  await writeJson(path.join(packageDir, "06_editing_package/provider_task_manifest.json"), {
    provider: config.provider,
    imageOnly: true,
    videoGeneration: "manual-dreamina-image-to-video",
    browserSupervisionPolicy,
    routes,
    dreaminaImageToVideoTasks: dreaminaVideoTasks.length
  });
}

function buildDreaminaCommand(prompt, dreamina) {
  const command = [
    "dreamina",
    "text2image",
    `--prompt=${prompt}`,
    `--ratio=${dreamina.ratio}`,
    `--resolution_type=${dreamina.resolutionType}`,
    `--poll=${dreamina.pollSeconds}`
  ];
  if (dreamina.modelVersion) command.push(`--model_version=${dreamina.modelVersion}`);
  if (dreamina.sessionId) command.push(`--session=${dreamina.sessionId}`);
  return command;
}

async function importAcceptedFile(packageDir, item) {
  const sourcePath = requiredPath(item.sourcePath, "acceptedFiles.sourcePath");
  const provider = item.provider ?? "chatgpt-web-image2";
  const folder = provider === "chatgpt-web-image2" ? "03_key_images_chatgpt" : "04_bulk_images_dreamina";
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  const attempt = Number(item.attempt ?? 1);
  const target = path.join(packageDir, folder, `${item.shotId}_${provider}_a${attempt}${extension}`);
  await mkdir(path.dirname(target), { recursive: true });
  await moveFile(sourcePath, target);
  const entry = {
    timestamp: new Date().toISOString(),
    shotId: item.shotId,
    provider,
    attempt,
    from: sourcePath,
    to: target
  };
  await appendJsonLines(path.join(packageDir, "07_review_log/download_moves.jsonl"), [entry]);
  return entry;
}

async function moveFile(source, target) {
  try {
    await rename(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await copyFile(source, target);
    await unlink(source);
  }
}

async function refreshPackageIndex(packageDir) {
  const manifestPath = path.join(packageDir, "06_editing_package/editing_manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await upsertPackageIndex({
    outputRoot: path.dirname(packageDir),
    entry: {
      slug: path.basename(packageDir).replace(/^\d{4}-\d{2}-\d{2}-/u, ""),
      packageName: path.basename(packageDir),
      provider: manifest.provider ?? "mixed",
      mode: manifest.mode,
      storyCategory: manifest.storyCategory,
      productCategory: manifest.productCategory,
      status: "completed",
      path: packageDir,
      generated: {
        total: manifest.shots.length,
        accepted: manifest.shots.length,
        failed: 0
      },
      manualReview: 0
    }
  });
}

async function createPackageDirectories(packageDir) {
  await Promise.all(
    [
      "00_script",
      "01_storyboard",
      "02_prompts",
      "03_key_images_chatgpt",
      "04_bulk_images_dreamina",
      "05_video_clips_dreamina",
      "06_editing_package",
      "07_review_log"
    ].map((dir) => mkdir(path.join(packageDir, dir), { recursive: true }))
  );
}

async function recordAppCheckpoint(packageDir, tool, details = {}) {
  await appendJsonLines(path.join(packageDir, "07_review_log/app_tool_checkpoints.jsonl"), [
    {
      timestamp: new Date().toISOString(),
      tool,
      status: "completed",
      ...details
    }
  ]);
}

async function writeJson(filePath, value) {
  await writeText(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function appendJsonLines(filePath, entries) {
  if (!entries.length) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
}

function requiredPath(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

function slugify(value) {
  return (
    String(value ?? "tiktok-producer-run")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "tiktok-producer-run"
  );
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
