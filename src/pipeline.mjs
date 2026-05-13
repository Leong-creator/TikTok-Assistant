import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildDreaminaText2ImageArgs,
  extractDreaminaSessionId,
  nextDreaminaConcurrency,
  runDreaminaQueue
} from "./dreamina-provider.mjs";
import { browserSupervisionPolicySummary } from "./browser-supervision-policy.mjs";
import { upsertPackageIndex } from "./package-index.mjs";

const execFileAsync = promisify(execFile);

export const PIPELINE_PHASES = [
  "preparePackage",
  "buildStoryboard",
  "planPrompts",
  "generateAssets",
  "reviewAssets",
  "finalizePackage"
];

const MODES = {
  calibration: { totalShots: 12, videoShots: 8, chatgptImageCount: 12 },
  pilot: { totalShots: 28, videoShots: 12, chatgptImageCount: 20 },
  test: { totalShots: 20, videoShots: 8, chatgptImageCount: 20 },
  standard: { totalShots: 40, videoShots: 14, chatgptImageCount: 32 },
  full: { totalShots: 80, videoShots: 24, chatgptImageCount: 48 }
};

const PRESETS = {
  "american-comic-realistic": {
    label: "American semi-realistic comic",
    style:
      "American semi-realistic comic illustration, modern graphic novel look, cinematic everyday lighting, warm soft side light, clean bold ink lines, realistic body proportions, sharp 4K detail, high contrast but natural color grading, clean stable composition, no speech bubbles, no dialogue boxes, no watermark",
    usage: "default story scenes"
  },
  "business-storyboard": {
    label: "Business story",
    style:
      "American semi-realistic business storyboard, hotel lobby, office, car dealership, restaurant, cash and contract visual symbols, cinematic warm light, clean graphic novel composition, realistic adult characters",
    usage: "money and business cases"
  },
  "parenting-book": {
    label: "Parenting book",
    style:
      "American street-smart parenting book commercial illustration, dramatic adult family conflict at home, mentor teaching boundaries, later transition to children learning real-world problem solving, polished TikTok story-ad style, expressive faces, warm interior light with slight noir contrast",
    usage: "children, parenting books, family boundaries and street-smart education scripts"
  },
  "people-skill-drama": {
    label: "People skill drama",
    style:
      "American office and social conflict illustration, adults in meetings, public transit, hotel and social gatherings, expressive body language, cinematic comic framing, clear interpersonal tension",
    usage: "people skill and social intelligence scripts"
  },
  "money-contrast": {
    label: "Money contrast",
    style:
      "American wealth contrast illustration, debt stress versus luxury dream scenes, bills, cars, houses, cash, office towers, cinematic dramatic lighting, clean vertical storytelling",
    usage: "wealth, debt and money scripts"
  },
  "stick-figure-info": {
    label: "Stick figure info",
    style:
      "Minimal black silhouette puppet characters, round glossy heads, thick white outline, business infographic comic style, high contrast, simple background, huge readable subject, clean vertical composition",
    usage: "fallback stable information scenes"
  }
};

const BASE_VISUAL_STYLE =
  "American semi-realistic comic illustration, modern graphic novel look, cinematic everyday lighting, warm soft side light, clean bold ink lines, realistic body proportions, sharp 4K detail";

const CATEGORY_PRESETS = {
  people_skill: "people-skill-drama",
  raise_children: "parenting-book",
  make_money: "money-contrast",
  business: "business-storyboard",
  default: "american-comic-realistic"
};

export async function generateAssetPackage(options) {
  const config = normalizeOptions(options);
  const packageDir = path.join(config.outputRoot, `${formatLocalDate(config.now)}-${config.slug}`);
  await createPackageDirectories(packageDir);
  await resetPipelineCheckpoints(packageDir);
  await recordPipelineCheckpoint(packageDir, config, "preparePackage", {
    status: "completed",
    resumeFrom: config.resumeFrom,
    packageDir
  });

  const originalScript = config.script.trim();
  const cleanedScript = cleanTranscriptScript(originalScript);
  const taxonomy = resolveTaxonomy(cleanedScript, config);
  const localizedScript = localizeScript(cleanedScript, config.language, config.region);
  const storyboardPath = path.join(packageDir, "01_storyboard/storyboard.json");
  const promptsPath = path.join(packageDir, "02_prompts/prompts.json");
  const reusedStoryboard = await maybeReadJson(storyboardPath, shouldReusePhaseOutput(config, "buildStoryboard"));
  const shots = reusedStoryboard ?? buildStoryboard(localizedScript, config.totalShots, config.videoShots, taxonomy);
  await recordPipelineCheckpoint(packageDir, config, "buildStoryboard", {
    status: "completed",
    loadedFromExisting: Boolean(reusedStoryboard),
    shotCount: shots.length,
    videoShots: shots.filter((shot) => shot.assetType === "video").length
  });

  const reusedPrompts = await maybeReadJson(promptsPath, shouldReusePhaseOutput(config, "planPrompts"));
  const prompts = reusedPrompts ?? shots.map((shot) => buildPromptForShot(shot, taxonomy));
  await recordPipelineCheckpoint(packageDir, config, "planPrompts", {
    status: "completed",
    loadedFromExisting: Boolean(reusedPrompts),
    promptCount: prompts.length
  });

  await writeText(path.join(packageDir, "00_script/original.txt"), originalScript + "\n");
  await writeText(path.join(packageDir, "00_script/cleaned_script.txt"), cleanedScript + "\n");
  await writeText(path.join(packageDir, "00_script/localized.txt"), localizedScript + "\n");
  await writeJson(storyboardPath, shots);
  await writeJson(promptsPath, prompts);

  await resolveDreaminaSessionIfNeeded(config);

  const generation = await generateAndReviewAssets({
    packageDir,
    prompts,
    config,
    forceRejectShotIds: config.forceRejectShotIds
  });
  await recordPipelineCheckpoint(packageDir, config, "generateAssets", {
    status: "completed",
    accepted: generation.acceptedAssets.length,
    manualReview: generation.needsManualReview.length
  });

  const manifest = buildEditingManifest(generation.acceptedAssets, config, taxonomy);
  await writeJson(path.join(packageDir, "06_editing_package/editing_manifest.json"), manifest);
  await writeText(path.join(packageDir, "06_editing_package/editing_manifest.csv"), toCsv(manifest.shots));
  await writeText(path.join(packageDir, "06_editing_package/manual_capcut_steps.md"), buildManualCapCutGuide(manifest));
  await writeText(path.join(packageDir, "07_review_log/prompt_iterations.jsonl"), generation.reviewLines.join("\n") + "\n");
  await writeJson(path.join(packageDir, "07_review_log/needs_manual_review.json"), generation.needsManualReview);
  await recordPipelineCheckpoint(packageDir, config, "reviewAssets", {
    status: "completed",
    reviewLines: generation.reviewLines.length,
    manualReview: generation.needsManualReview.length
  });
  await writeText(path.join(packageDir, "07_review_log/checkpoint_log.md"), buildCheckpointLog(config, taxonomy, manifest, generation));
  await upsertPackageIndex({
    outputRoot: config.outputRoot,
    entry: {
      slug: config.slug,
      packageName: path.basename(packageDir),
      scriptTitle: firstScriptTitle(cleanedScript),
      provider: config.provider,
      mode: config.mode,
      totalShots: config.totalShots,
      videoShots: config.videoShots,
      chatgptImageCount: config.chatgptImageCount,
      routingPlan: config.routingPlan ?? "dynamic",
      storyCategory: taxonomy.storyCategory,
      productCategory: taxonomy.productCategory,
      status: "completed",
      path: packageDir,
      generated: {
        total: shots.length,
        accepted: generation.acceptedAssets.length,
        failed: generation.needsManualReview.length
      },
      manualReview: generation.needsManualReview.length
    }
  });
  const routeSummary = summarizeRouteCounts(prompts, config);
  await recordPipelineCheckpoint(packageDir, config, "finalizePackage", {
    status: "completed",
    manifestShots: manifest.shots.length,
    indexed: true
  });

  return {
    packageDir,
    summary: {
      mode: config.mode,
      provider: config.provider,
      category: taxonomy.storyCategory,
      storyCategory: taxonomy.storyCategory,
      productCategory: taxonomy.productCategory,
      conversionAngle: taxonomy.conversionAngle,
      totalShots: shots.length,
      videoShots: shots.filter((shot) => shot.assetType === "video").length,
      imageShots: shots.filter((shot) => shot.assetType === "image").length,
      chatgptImageShots: routeSummary.chatgptImageShots,
      dreaminaImageShots: routeSummary.dreaminaImageShots,
      dreaminaVideoShots: prompts.filter((prompt) => prompt.assetType === "video").length,
      manualReview: generation.needsManualReview.length
    }
  };
}

export async function generateAssetPackageFromFile(options) {
  const script = await readFile(options.scriptPath, "utf8");
  return generateAssetPackage({ ...options, script });
}

export async function retryPackageShots(options) {
  const packageDir = path.resolve(options.packageDir);
  const requestedShotIds = [...new Set(options.shots ?? [])];
  if (!requestedShotIds.length) {
    throw new Error("at least one shot id is required for retry");
  }

  const promptsPath = path.join(packageDir, "02_prompts/prompts.json");
  const manifestPath = path.join(packageDir, "06_editing_package/editing_manifest.json");
  const needsManualPath = path.join(packageDir, "07_review_log/needs_manual_review.json");
  const prompts = JSON.parse(await readFile(promptsPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const needsManualReview = await readJsonOrDefault(needsManualPath, []);
  const provider = options.provider ?? "dreamina-image";
  const config = {
    provider,
    providerAdapters: options.providerAdapters ?? {},
    imageOnly: true,
    keyImageCount: 0,
    mode: manifest.mode ?? "test",
    language: manifest.language ?? "en-US",
    region: manifest.region ?? "United States",
    slug: path.basename(packageDir),
    now: options.now ?? new Date(),
    dreamina: {
      modelVersion: options.dreamina?.modelVersion ?? "4.0",
      resolutionType: options.dreamina?.resolutionType ?? "2k",
      ratio: options.dreamina?.ratio ?? "9:16",
      pollSeconds: Number(options.dreamina?.pollSeconds ?? 90),
      sessionId: options.dreamina?.sessionId,
      sessionName: normalizeDreaminaSessionName(options.dreamina?.sessionName ?? `retry-${path.basename(packageDir)}`),
      concurrency: Number(options.dreamina?.concurrency ?? 1)
    },
    forceRejectShotIds: new Set()
  };

  await resolveDreaminaSessionIfNeeded(config);

  const promptById = new Map(prompts.map((prompt) => [prompt.shotId, prompt]));
  const retriedShotIds = [];
  const retryReviewLines = [];
  const visualReviewLines = [];
  const acceptedShotIds = new Set();

  for (const shotId of requestedShotIds) {
    const prompt = promptById.get(shotId);
    if (!prompt) {
      throw new Error(`shot ${shotId} not found in ${promptsPath}`);
    }
    const fixedPrompt = applyRetryPromptFixes(prompt);
    Object.assign(prompt, fixedPrompt);
    const existingManifestShot = manifest.shots.find((shot) => shot.shotId === shotId);
    const attempt = Number(existingManifestShot?.attempts ?? 1) + 1;
    const route = selectProviderRoute(prompt, config);
    const asset = await generateAssetWithProvider({ packageDir, prompt, attempt, route, config });
    const review = reviewAsset(prompt, asset, false);
    const reviewEntry = {
      timestamp: new Date().toISOString(),
      retry: true,
      shotId,
      attempt,
      provider: asset.provider,
      storyboardAssetType: prompt.assetType,
      generatedAssetType: asset.assetType,
      originalPrompt: prompt.imagePrompt,
      generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
      videoPrompt: prompt.videoPrompt,
      dreaminaVideoPrompt: prompt.dreaminaVideoPrompt,
      issue: review.issue,
      promptChange: review.promptChange,
      status: review.status,
      assetPath: asset.relativePath
    };
    retryReviewLines.push(reviewEntry);
    visualReviewLines.push({
      timestamp: reviewEntry.timestamp,
      retry: true,
      shotId,
      status: review.status,
      provider: asset.provider,
      assetPath: asset.relativePath,
      notes: review.issue || "accepted after targeted retry"
    });
    retriedShotIds.push(shotId);
    if (review.status !== "accepted") continue;

    acceptedShotIds.add(shotId);
    const nextManifestShot = {
      ...(existingManifestShot ?? {}),
      shotId,
      order: prompt.order,
      category: manifest.category,
      assetType: asset.assetType,
      storyboardAssetType: existingManifestShot?.storyboardAssetType ?? prompt.assetType,
      provider: asset.provider,
      assetPath: asset.relativePath,
      durationSeconds: existingManifestShot?.durationSeconds ?? (prompt.assetType === "video" ? 5 : 3),
      captionText: prompt.line,
      suggestedEdit: buildSuggestedEdit({ ...asset, prompt, storyboardAssetType: prompt.assetType }),
      promptPreset: prompt.presetId,
      segmentName: prompt.segmentName,
      operatorSectionName: prompt.operatorSectionName,
      imageRole: prompt.imageRole,
      chatgptBatchPolicy: prompt.chatgptBatchPolicy,
      dreaminaVideoPrompt: prompt.dreaminaVideoPrompt,
      attempts: attempt
    };
    const manifestIndex = manifest.shots.findIndex((shot) => shot.shotId === shotId);
    if (manifestIndex >= 0) {
      manifest.shots[manifestIndex] = nextManifestShot;
    } else {
      manifest.shots.push(nextManifestShot);
    }
  }

  manifest.shots.sort((left, right) => Number(left.order) - Number(right.order));
  const nextNeedsManualReview = needsManualReview.filter((item) => !acceptedShotIds.has(item.shotId));
  for (const entry of retryReviewLines) {
    if (entry.status === "accepted") continue;
    nextNeedsManualReview.push({
      shotId: entry.shotId,
      attempts: entry.attempt,
      reason: `${entry.issue}; manual review required after targeted retry`,
      prompt: entry.originalPrompt,
      generationPrompt: entry.generationPrompt,
      dreaminaVideoPrompt: entry.dreaminaVideoPrompt
    });
  }

  await writeJson(promptsPath, prompts);
  await writeJson(manifestPath, manifest);
  await writeText(path.join(packageDir, "06_editing_package/editing_manifest.csv"), toCsv(manifest.shots));
  await appendJsonLines(path.join(packageDir, "07_review_log/prompt_iterations.jsonl"), retryReviewLines);
  await appendJsonLines(path.join(packageDir, "07_review_log/visual_review.jsonl"), visualReviewLines);
  await writeJson(needsManualPath, nextNeedsManualReview);
  const originalScript = await readFile(path.join(packageDir, "00_script/original.txt"), "utf8").catch(() => "");
  await upsertPackageIndex({
    outputRoot: path.dirname(packageDir),
    entry: {
      slug: path.basename(packageDir).replace(/^\d{4}-\d{2}-\d{2}-/u, ""),
      packageName: path.basename(packageDir),
      scriptTitle: firstScriptTitle(originalScript),
      provider,
      mode: manifest.mode ?? "test",
      status: "completed",
      path: packageDir,
      generated: {
        total: manifest.shots.length,
        accepted: manifest.shots.length,
        failed: nextNeedsManualReview.length
      },
      manualReview: nextNeedsManualReview.length,
      lastRetry: {
        shotIds: retriedShotIds,
        accepted: [...acceptedShotIds]
      }
    }
  });

  return {
    packageDir,
    retriedShotIds,
    acceptedShotIds: [...acceptedShotIds],
    manualReview: nextNeedsManualReview.filter((item) => requestedShotIds.includes(item.shotId))
  };
}

function normalizeOptions(options) {
  if (!options?.script || !options.script.trim()) {
    throw new Error("script is required");
  }
  const mode = options.mode ?? "test";
  if (!MODES[mode]) {
    throw new Error(`unsupported mode: ${mode}`);
  }
  const modeConfig = MODES[mode];
  const totalShots = normalizeCount(options.totalShots, modeConfig.totalShots, "totalShots");
  const videoShots = Math.min(normalizeCount(options.videoShots, modeConfig.videoShots, "videoShots"), totalShots);
  const chatgptImageCount = Math.min(
    normalizeCount(
      options.chatgptImageCount ?? options.keyImageCount,
      options.keyImageCount ? Number(options.keyImageCount) : modeConfig.chatgptImageCount,
      "chatgptImageCount"
    ),
    totalShots
  );
  return {
    script: options.script,
    outputRoot: options.outputRoot ?? path.resolve("outputs"),
    slug: slugify(options.slug ?? "tiktok-content"),
    mode,
    provider: options.provider ?? "mock",
    providerAdapters: options.providerAdapters ?? {},
    imageOnly: Boolean(options.imageOnly),
    keyImageCount: Number(options.keyImageCount ?? 3),
    totalShots,
    videoShots,
    chatgptImageCount,
    routingPlan: options.routingPlan,
    storyCategory: options.storyCategory,
    productCategory: options.productCategory,
    storyPreset: options.storyPreset,
    conversionAngle: options.conversionAngle,
    chatgptShotIds: buildChatGptShotIdSet({ totalShots, videoShots, chatgptImageCount, routingPlan: options.routingPlan }),
    dreamina: {
      modelVersion: options.dreamina?.modelVersion ?? "4.0",
      resolutionType: options.dreamina?.resolutionType ?? "2k",
      ratio: options.dreamina?.ratio ?? "9:16",
      pollSeconds: Number(options.dreamina?.pollSeconds ?? 90),
      sessionId: options.dreamina?.sessionId,
      sessionName: normalizeDreaminaSessionName(options.dreamina?.sessionName ?? `tiktok-${slugify(options.slug ?? "tiktok-content")}`),
      concurrency: Number(options.dreamina?.concurrency ?? 2)
    },
    now: options.now ?? new Date(),
    language: options.language ?? "en-US",
    region: options.region ?? "United States",
    category: options.category,
    resumeFrom: options.resumeFrom,
    forceRejectShotIds: new Set(options.forceRejectShotIds ?? [])
  };
}

function normalizeCount(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.trunc(number);
}

async function createPackageDirectories(packageDir) {
  const dirs = [
    "00_script",
    "01_storyboard",
    "02_prompts",
    "03_key_images_chatgpt",
    "04_bulk_images_dreamina",
    "05_video_clips_dreamina",
    "06_editing_package",
    "07_review_log"
  ];
  await Promise.all(dirs.map((dir) => mkdir(path.join(packageDir, dir), { recursive: true })));
}

async function resetPipelineCheckpoints(packageDir) {
  await writeText(path.join(packageDir, "07_review_log/pipeline_checkpoints.jsonl"), "");
}

async function recordPipelineCheckpoint(packageDir, config, phase, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    phase,
    status: details.status ?? "completed",
    provider: config.provider,
    mode: config.mode
  };
  if (config.resumeFrom) {
    entry.resumeFrom = config.resumeFrom;
    entry.resumed = phase === config.resumeFrom;
  }
  const rest = { ...details };
  delete rest.status;
  Object.assign(entry, rest);
  await appendFile(path.join(packageDir, "07_review_log/pipeline_checkpoints.jsonl"), JSON.stringify(entry) + "\n", "utf8");
}

async function resolveDreaminaSessionIfNeeded(config) {
  if (!usesDreaminaProvider(config)) return;
  if (config.providerAdapters.dreaminaImage) return;
  if (config.dreamina.sessionId || !config.dreamina.sessionName) return;
  const searched = await runProviderCommand("dreamina", ["session", "search", config.dreamina.sessionName]).catch(() => ({
    stdout: ""
  }));
  const existingId = extractDreaminaSessionId(searched.stdout);
  if (existingId) {
    config.dreamina.sessionId = existingId;
    return;
  }
  const created = await runProviderCommand("dreamina", ["session", "create", config.dreamina.sessionName]);
  const createdId = extractDreaminaSessionId(created.stdout);
  if (!createdId) {
    throw new Error(`Dreamina session could not be resolved or created for ${config.dreamina.sessionName}`);
  }
  config.dreamina.sessionId = createdId;
}

function usesDreaminaProvider(config) {
  return config.provider === "dreamina-image" || config.provider === "image-mvp";
}

function inferCategory(script) {
  const text = script.toLowerCase();
  if (/(child|children|kid|parent|school|raise|family|teacher)/.test(text)) return "raise_children";
  if (/(people skill|social|friend|relationship|office|meeting|conversation)/.test(text)) return "people_skill";
  if (/(money|wealth|rich|cash|debt|business|hotel|rent|bill|system)/.test(text)) return "make_money";
  return "default";
}

function resolveTaxonomy(script, config) {
  const storyCategory = config.storyCategory ?? config.category ?? inferCategory(script);
  const productCategory = config.productCategory ?? storyCategory;
  return {
    category: storyCategory,
    storyCategory,
    productCategory,
    storyPreset: config.storyPreset ?? chooseStoryPreset(storyCategory),
    conversionAngle: config.conversionAngle ?? defaultConversionAngle(storyCategory, productCategory)
  };
}

function chooseStoryPreset(storyCategory) {
  if (storyCategory === "make_money" || storyCategory === "business") return "business-storyboard";
  return CATEGORY_PRESETS[storyCategory] ?? CATEGORY_PRESETS.default;
}

function defaultConversionAngle(storyCategory, productCategory) {
  if (storyCategory === "make_money" && productCategory === "raise_children") {
    return "use a money story to sell children real-world judgment and financial literacy";
  }
  return "";
}

function cleanTranscriptScript(script) {
  const lines = script
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const averageWords = lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length;
  if (lines.length < 10 || averageWords >= 8 || /[.!?。！？]/u.test(script)) {
    return splitSentences(script).join("\n");
  }
  return mergeTranscriptFragments(lines).join("\n");
}

function mergeTranscriptFragments(lines) {
  const sentenceBreakStarters = /^(before long|one month later|a few months later|in profit after that|one day|but as|this was|saying no|saying yes|this is what|after selling|his father answered|within a month|he asked|his father shook|a few days later|only then|from then on|in less than|when his brother|but his wealthy father|his brother in law refused|he didn't understand|but his father insisted)\b/i;
  const sentences = [];
  let current = [];
  for (const line of lines) {
    if (current.length && (sentenceBreakStarters.test(line) || wordCount(current) >= 26)) {
      sentences.push(sentenceFromFragments(current));
      current = [];
    }
    current.push(line);
  }
  if (current.length) {
    sentences.push(sentenceFromFragments(current));
  }
  return sentences;
}

function wordCount(lines) {
  return lines.join(" ").split(/\s+/).filter(Boolean).length;
}

function sentenceFromFragments(lines) {
  const sentence = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!sentence) return "";
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
}

function localizeScript(script, language, region) {
  const normalized = splitSentences(script).join("\n");
  return [
    `[Localized draft: ${language}, ${region}]`,
    "Keep the book title unchanged. Replace culturally specific details with locally plausible US examples.",
    normalized
  ].join("\n");
}

function firstScriptTitle(script) {
  return splitSentences(script)[0] || script.trim().split(/\r?\n/)[0] || "Untitled script";
}

function shouldReusePhaseOutput(config, phase) {
  if (!config.resumeFrom) return false;
  return phaseOrder(config.resumeFrom) > phaseOrder(phase);
}

function phaseOrder(phase) {
  const index = PIPELINE_PHASES.indexOf(phase);
  return index >= 0 ? index : -1;
}

function splitSentences(script) {
  const placeholders = new Map([
    ["U.S.", "U__S__"],
    ["U.K.", "U__K__"],
    ["U.N.", "U__N__"]
  ]);
  let protectedScript = script;
  for (const [source, placeholder] of placeholders.entries()) {
    protectedScript = protectedScript.replaceAll(source, placeholder);
  }
  return protectedScript
    .replace(/\r/g, "")
    .split(/\n|(?<=[.!?。！？])\s+/u)
    .map((line) => line.trim())
    .map((line) => restoreSentencePlaceholders(line, placeholders))
    .filter(Boolean);
}

function restoreSentencePlaceholders(line, placeholders) {
  let restored = line;
  for (const [source, placeholder] of placeholders.entries()) {
    restored = restored.replaceAll(placeholder, source);
  }
  return restored;
}

function buildStoryboard(script, totalShots, videoShots, taxonomy) {
  const scriptLines = splitSentences(script).filter(
    (line) =>
      !line.startsWith("[Localized draft:") &&
      !line.startsWith("Keep the book title unchanged.") &&
      !line.startsWith("Replace culturally specific details")
  );
  const usableLines = scriptLines.length ? scriptLines : ["A compelling TikTok product story unfolds."];
  const shots = [];
  const segmentPlan = buildSegmentPlan(totalShots, videoShots, taxonomy);

  for (let index = 0; index < totalShots; index += 1) {
    const shotNumber = index + 1;
    const id = `S${String(shotNumber).padStart(3, "0")}`;
    const sentence = usableLines[index % usableLines.length];
    const segment = segmentForOrder(shotNumber, segmentPlan);
    shots.push({
      id,
      order: shotNumber,
      category: taxonomy.storyCategory,
      storyCategory: taxonomy.storyCategory,
      productCategory: taxonomy.productCategory,
      conversionAngle: taxonomy.conversionAngle,
      section: segment.section,
      segmentName: segment.name,
      operatorSectionName: segment.operatorName,
      assetType: segment.assetType,
      imageRole: segment.imageRole,
      durationSeconds: segment.assetType === "video" ? 5 : 3,
      line: sentence,
      subjectTag: chooseSubjectTag(sentence),
      visualBeat: buildVisualBeat(sentence, segment.section, taxonomy)
    });
  }

  return shots;
}

function buildSegmentPlan(totalShots, videoShots, taxonomy) {
  const frontTarget = clampCount(Math.round(totalShots * 0.15), 6, 12);
  const frontVideoShots = Math.min(totalShots, videoShots, frontTarget);
  const remainingAfterFront = Math.max(0, totalShots - frontVideoShots);
  const backVideoShots = Math.min(Math.max(0, videoShots - frontVideoShots), remainingAfterFront);
  const desiredBookBroll = taxonomy.productCategory === "raise_children" ? 4 : 2;
  const bookBrollShots = Math.min(desiredBookBroll, Math.max(0, totalShots - frontVideoShots - backVideoShots));
  const backSegmentShots = backVideoShots + bookBrollShots;
  const backStartOrder = backSegmentShots > 0 ? totalShots - backSegmentShots + 1 : totalShots + 1;
  const bookBrollStartOrder = bookBrollShots > 0 ? totalShots - bookBrollShots + 1 : totalShots + 1;
  return {
    totalShots,
    frontVideoShots,
    backVideoShots,
    bookBrollShots,
    backStartOrder,
    bookBrollStartOrder
  };
}

function clampCount(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function segmentForOrder(order, plan) {
  if (order <= plan.frontVideoShots) {
    return {
      section: "hook_video",
      name: "front_video",
      operatorName: "首段钩子视频",
      assetType: "video",
      imageRole: "dreamina_video_first_frame"
    };
  }
  if (order >= plan.bookBrollStartOrder) {
    return {
      section: "book_broll",
      name: "book_broll",
      operatorName: "图书空镜",
      assetType: "image",
      imageRole: "book_or_product_broll"
    };
  }
  if (order >= plan.backStartOrder) {
    return {
      section: "conversion_video",
      name: "back_video",
      operatorName: "后段转化视频",
      assetType: "video",
      imageRole: "dreamina_video_first_frame"
    };
  }
  return {
    section: "story_image",
    name: "middle_image",
    operatorName: "中段叙事图片",
    assetType: "image",
    imageRole: "story_image"
  };
}

function chooseSubjectTag(sentence) {
  if (/(book|page|cover|cash|bill|car|room|phone|contract|hotel|ferrari|house|commission|father|woman)/i.test(sentence)) return "person_and_object";
  if (/(system|truth|lesson|difference|idea|mindset)/i.test(sentence)) return "object_or_symbol";
  return "person";
}

function buildVisualBeat(sentence, section, taxonomy) {
  if (section === "hook_video") {
    if (taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business") {
      return buildBusinessHookBeat(sentence);
    }
    return `Open with visible conflict: adult characters react strongly to the idea "${sentence}".`;
  }
  if (section === "conversion_video") {
    if (taxonomy.productCategory === "raise_children") {
      return `Turn the story lesson into a final short video beat about parents teaching children real-world judgment, relationship rules, and practical money sense: "${sentence}".`;
    }
    return `Turn the lesson into a short conversion video beat while preserving the story context: "${sentence}".`;
  }
  if (section === "book_broll") {
    if (taxonomy.productCategory === "raise_children") {
      return `Show a clean book/product b-roll moment that supports the parenting and financial-literacy offer without readable cover text: "${sentence}".`;
    }
    return `Show a clean book or product b-roll moment while preserving the story context: "${sentence}".`;
  }
  if (taxonomy.storyCategory === "raise_children") {
    return `Show a parent, child, classroom or home-learning moment that makes the line understandable without audio: "${sentence}".`;
  }
  if (taxonomy.storyCategory === "people_skill") {
    return `Show adult social tension, office body language or public interaction that embodies the line: "${sentence}".`;
  }
  return `Show a concrete money, business, hotel, real estate, Ferrari dealership, wealthy relationship, or office scene that embodies the line: "${sentence}".`;
}

function buildBusinessHookBeat(sentence) {
  const normalized = sentence.toLowerCase();
  if (normalized.includes("settlement") || normalized.includes("20 million") || normalized.includes("mansion")) {
    return `Open with a scroll-stopping money hook for "${sentence}": a confident man in a luxury hotel while flying cash, shocked bystanders, marble floors, chandeliers, and strong money-status contrast make the windfall instantly visible.`;
  }
  if (normalized.includes("hotel") || normalized.includes("breakfast") || normalized.includes("housekeeping") || normalized.includes("shower")) {
    return `Show hotel luxury as a visible money shock for "${sentence}": premium service, breakfast, fresh sheets, flying cash, stunned hotel staff, and money-status contrast make it obvious that investment income covers the lifestyle.`;
  }
  if (normalized.includes("interest") || normalized.includes("principal")) {
    return `Make passive income visually shocking for "${sentence}": cash rain and glowing cash flow cover luxury bills while untouched principal sits protected, creating a clear money-status contrast.`;
  }
  if (normalized.includes("real estate") || normalized.includes("unit") || normalized.includes("building")) {
    return `Show a high-stakes real estate play for "${sentence}": contracts, property models, jealous coworkers, and a confident buyer create a commission-and-status hook.`;
  }
  if (normalized.includes("friends") || normalized.includes("relationships") || normalized.includes("gifts")) {
    return `Show a relationship-driven luxury sales hook for "${sentence}": a wealthy woman brings friends into the showroom, the salesman offers respectful gifts, and referral money creates visible social leverage.`;
  }
  if (normalized.includes("ferrari") || normalized.includes("car") || normalized.includes("dealership")) {
    return `Show a luxury-car sales hook for "${sentence}": bright Ferrari showroom, wealthy buyer, stunned onlookers, and visible status tension around the purchase.`;
  }
  if (normalized.includes("father") || normalized.includes("dad")) {
    return `Show a business-mentor hook for "${sentence}": wealthy father teaching a sharp rule at a desk while money, relationship, and status symbols make the lesson feel valuable.`;
  }
  return `Open with a scroll-stopping business hook for "${sentence}": visible money, luxury status contrast, surprised reactions, contracts, and emotional tension make the payoff clear without audio.`;
}

function buildPromptForShot(shot, taxonomy) {
  const presetId = choosePresetForShot(shot, taxonomy);
  const preset = PRESETS[presetId];
  const camera = shot.assetType === "video" ? "slow push-in, subtle parallax, cinematic handheld tension" : "stable frame for Ken Burns zoom";
  const imagePrompt = buildChatGptImagePrompt({ shot, taxonomy, preset, camera });
  const generationPrompt = [
    "竖版单张电影插画剧照，现代美式插画质感，暖色电影光线，真实人体比例，人物表情清楚，画面有现实商业故事的戏剧张力。",
    `${buildDreaminaStyleLine(shot, taxonomy)}`,
    "竖版构图，单幅完整画面，只保留同一个连续场景，不要多格画面，不要拼贴，不要左右分屏，不要上下分屏，不要画中画，不要重复场景，不要界面叠层。",
    "无字版画面，只呈现人物、环境和物件，不要出现任何文字，不要标题，不要水印，不要商标，不要数字，不要界面元素，不要把提示词里的任何字符画进画面。",
    `画面内容：${translateVisualBeatForDreamina(shot)}。`,
    `主体重点：${translateSubjectTag(shot.subjectTag)}。`,
    `镜头感觉：${translateCameraForDreamina(camera)}。`,
    `${buildDreaminaCompositionLine(shot, taxonomy)}`
  ].join(" ");
  const videoPrompt = buildGenericVideoPrompt(shot);
  const dreaminaVideoPrompt = shot.assetType === "video" ? buildDreaminaImageToVideoPrompt(shot, taxonomy) : "";

  return {
    shotId: shot.id,
    order: shot.order,
    section: shot.section,
    segmentName: shot.segmentName,
    operatorSectionName: shot.operatorSectionName,
    presetId,
    presetLabel: preset.label,
    assetType: shot.assetType,
    imageRole: shot.imageRole,
    chatgptBatchPolicy: buildChatGptBatchPolicy(shot),
    storyCategory: taxonomy.storyCategory,
    productCategory: taxonomy.productCategory,
    conversionAngle: taxonomy.conversionAngle,
    line: shot.line,
    visualBeat: shot.visualBeat,
    imagePrompt,
    generationPrompt,
    videoPrompt,
    dreaminaVideoPrompt
  };
}

function buildChatGptImagePrompt({ shot, taxonomy, preset, camera }) {
  const characters = buildChatGptCharacterLine(shot, taxonomy);
  const videoFirstFrameLine =
    shot.assetType === "video"
      ? "This image is a first frame for image-to-video generation: choose a pose, spatial direction, facial tension, and environment that can naturally animate in the next 3-5 seconds."
      : "This image is a standalone story frame for manual CapCut motion.";
  return [
    "Create one image now.",
    "Output: one standalone 9:16 vertical full-frame image. Do not create a collage, storyboard page, split screen, panel grid, picture-in-picture, or sequence.",
    videoFirstFrameLine,
    `Style: ${BASE_VISUAL_STYLE}. ${preset.style}. Premium TikTok story-ad illustration, cinematic warm light, realistic adult proportions, high-detail 4K look, clean stable composition.`,
    `Subject type: ${shot.subjectTag}.`,
    `Shot intent: ${shot.visualBeat}`,
    `Camera/composition: ${camera}; make the main action readable in foreground and midground, with useful background details for later Ken Burns movement.`,
    `Characters: ${characters}`,
    `Action/relationship: ${shot.visualBeat}`,
    "Micro-expression: emphasize curiosity, conflict, status pressure, jealousy, surprise, or controlled confidence so the image can stop scrolling in the first second.",
    `Background: ${buildChatGptBackgroundLine(shot, taxonomy)}`,
    "Lighting/dynamics: warm cinematic side light, visible money/status contrast when relevant, full-frame visual density from top to bottom with no artificial blank bands.",
    "Negative constraints: no visible words, letters, numbers, captions, speech bubbles, logos, watermarks, subtitles, blank bottom band, extra limbs, distorted faces, unrelated scenes, Chinese text, or drawn shot labels."
  ].join("\n");
}

function buildChatGptCharacterLine(shot, taxonomy) {
  if (isConversionLikeSection(shot.section) && taxonomy.productCategory === "raise_children") {
    return "American parent, child, or mentor figures with realistic adult and child proportions; keep product/education visuals only in the conversion section.";
  }
  if (taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business") {
    return "Consistent adult American business-story cast: confident young male lead, luxury service workers, managers, coworkers, wealthy buyers, and a wealthy father mentor when needed.";
  }
  if (taxonomy.storyCategory === "people_skill") {
    return "Adult American social-conflict cast with realistic proportions, clear status differences, and expressive but believable body language.";
  }
  return "Adult American realistic story characters with consistent styling, clear body language, and readable emotional reactions.";
}

function buildChatGptBackgroundLine(shot, taxonomy) {
  if (isConversionLikeSection(shot.section) && taxonomy.productCategory === "raise_children") {
    return "warm American family learning space, table, papers or book-like objects without readable text, practical financial-literacy mood.";
  }
  if (taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business") {
    return "US luxury hotel, real-estate office, high-end car dealership, wealthy study, restaurant, cash, contracts, property models, or luxury objects matching this shot.";
  }
  if (taxonomy.storyCategory === "raise_children") {
    return "American home interior, doorway, living room, dining table, or practical family decision scene matching this shot.";
  }
  return "US-local scene details and props matching this story beat.";
}

function choosePresetForShot(shot, taxonomy) {
  if (isConversionLikeSection(shot.section) && taxonomy.productCategory === "raise_children") return "parenting-book";
  if (taxonomy.storyPreset) return taxonomy.storyPreset;
  return CATEGORY_PRESETS[taxonomy.storyCategory] ?? CATEGORY_PRESETS.default;
}

function buildDreaminaStyleLine(shot, taxonomy) {
  if (isConversionLikeSection(shot.section) && taxonomy.productCategory === "raise_children") {
    return "亲子财商教育主题，父母与孩子在温暖室内学习现实判断、人情关系和金钱规则，场面克制但有启发感，画面铺满，人物和环境自然延伸到上下边缘。";
  }
  if (taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business") {
    return "成人商业爽文主题，豪华酒店、房产公司、豪车展厅、富人关系和商业导师场景，人物克制但情绪紧张，画面铺满，人物和环境自然延伸到上下边缘。";
  }
  if (taxonomy.storyCategory === "raise_children") {
    return "成人家庭边界和亲子教育主题，普通美国家庭住宅场景，人物克制但情绪紧张，画面铺满，人物和环境自然延伸到上下边缘。";
  }
  return "成人现实故事主题，室内外生活场景清楚，人物克制但情绪紧张，画面铺满，人物和环境自然延伸到上下边缘。";
}

function buildDreaminaCompositionLine(shot, taxonomy) {
  const environment =
    isConversionLikeSection(shot.section) && taxonomy.productCategory === "raise_children"
      ? "环境要像温暖的美国家庭学习空间"
      : taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business"
        ? "环境要像美国高端酒店、房产办公室、豪车展厅或富人书房"
        : taxonomy.storyCategory === "raise_children"
          ? "环境要像美国普通家庭住宅"
          : "环境要像美国现实生活空间";
  return `人物动作要清楚，情绪要一眼可读，${environment}，主体和关键环境从上到下都有内容，构图要全画幅叙事，画面铺满。`;
}

function translateVisualBeatForDreamina(shot) {
  if (shot.section === "book_broll" && shot.productCategory === "raise_children") {
    return "温暖室内的图书空镜，桌上有翻开的空白书页、书签、铅笔和孩子做现实问题练习的纸张，书页不要出现可读文字，画面表达亲子财商教育和现实判断";
  }
  if (shot.section === "conversion_video" && shot.productCategory === "raise_children") {
    return "父母把赚钱故事里的规则讲给孩子听，孩子在旁边认真思考，桌上有翻开的空白纸页和生活物件，画面表达财商、人情世故和现实判断的教育承接";
  }
  const isParentingStory = shot.storyCategory === "raise_children" && shot.productCategory === "raise_children";
  if (isParentingStory && shot.id === "S015") {
    return "明亮家庭客厅中景，沙发和餐桌干净可见，成年人站在画面中央认真沟通，前景无遮挡，地面和桌下保持明亮清爽，画面稳定通透";
  }
  if (isParentingStory && shot.id === "S016") {
    return "两位成年人一前一后形成紧张站位，一人后退保护家庭空间，另一人拎包停在门口，靠表情、距离和手势表现冲突";
  }
  if (shot.section === "hook_video") {
    if (shot.storyCategory === "make_money" || shot.storyCategory === "business") {
      return describeBusinessLineForDreamina(shot.line);
    }
    return `用明显的家庭冲突开场，成年人围绕家庭边界、亲戚照顾和家中压力发生克制但紧张的对峙，画面只表现情境`;
  }
  if (isConversionLikeSection(shot.section)) {
    return `把故事教训自然连接到成年人阅读思考的场景，保留前面的家庭边界故事语境，纸质读物只露出翻开的空白页面`;
  }
  if (shot.storyCategory === "raise_children") {
    return describeParentingLineForDreamina(shot.line);
  }
  if (shot.storyCategory === "people_skill") {
    return "展示成年人社交压力、办公室肢体语言或公共互动冲突，让观众不听声音也能理解人物关系的紧张感";
  }
  return describeBusinessLineForDreamina(shot.line);
}

function isConversionLikeSection(section) {
  return section === "conversion_video" || section === "book_broll";
}

function buildGenericVideoPrompt(shot) {
  return [
    "Animate this approved first-frame image as one short TikTok story beat.",
    "Keep the same characters, face identity, wardrobe, environment, and style.",
    "Use one continuous shot with smooth camera movement, subtle character motion, natural lighting change, and no added text.",
    `Story intent: ${shot.visualBeat}`,
    "End with a stable frame that can cut cleanly to the next shot."
  ].join(" ");
}

function buildDreaminaImageToVideoPrompt(shot, taxonomy) {
  const movement = shot.section === "hook_video" ? buildDreaminaHookVideoAction(shot, taxonomy) : buildDreaminaConversionVideoAction(shot, taxonomy);
  return [
    "根据上传的首帧图生成一个竖版短视频片段，保持首帧人物长相、服装、场景、画风和光线一致。",
    `脚本意图：${translateVisualBeatForDreamina(shot)}。`,
    `首帧承接：从当前构图自然开始，不要换场景，不要新增无关人物。`,
    `人物动作变化：${movement.action}。`,
    `镜头运动：${movement.camera}。`,
    `情绪变化：${movement.emotion}。`,
    `场景动态：${movement.environment}。`,
    "节奏和时长：3-5 秒，前 1 秒抓住注意力，中间推进动作，最后 0.5 秒稳定收住方便剪辑。",
    `结尾状态：${movement.ending}。`,
    "负面约束：不要变脸，不要换衣服，不要跳场，不要多镜头拼接，不要文字，不要字幕，不要 logo，不要水印，不要夸张畸变，不要新增第二个版本的人物。"
  ].join(" ");
}

function buildDreaminaHookVideoAction(shot, taxonomy) {
  if (taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business") {
    return {
      action: "主角向画面深处或前景移动，周围人产生震惊反应，现金、合同、账单或豪车元素轻微运动，金钱冲击要比静态图更明显",
      camera: "缓慢推进并带轻微视差，让主角、现金/豪车/合同和围观者形成前中后景层次",
      emotion: "主角从克制自信到更坚定，旁观者从疑惑到震惊，形成强烈钩子",
      environment: "灯光和背景细节轻微变化，现金或纸张自然飘动，但不要遮住人物脸",
      ending: "停在主角与金钱/身份反差最清楚的一帧"
    };
  }
  return {
    action: "人物保持同一空间内的克制冲突，手势和身体距离逐渐变化",
    camera: "缓慢推进到表情和关系压力最清楚的位置",
    emotion: "从压抑到紧张，表情变化明显但不过度夸张",
    environment: "室内光线轻微变化，背景稳定不跳动",
    ending: "停在冲突关系最清楚的一帧"
  };
}

function buildDreaminaConversionVideoAction(shot, taxonomy) {
  if (taxonomy.productCategory === "raise_children") {
    return {
      action: "父母或导师轻轻翻开空白书页或把生活问题纸张推给孩子，孩子从困惑转为认真思考",
      camera: "从书页和手部轻微推进到父母与孩子的表情，保持温暖可信",
      emotion: "成年人平静坚定，孩子逐渐理解，形成教育转化感",
      environment: "书页、铅笔、桌面和暖光轻微运动，不能出现可读文字",
      ending: "停在孩子认真思考、书页和家庭学习氛围都清楚的一帧"
    };
  }
  return {
    action: "主角把故事中的规则自然连接到产品或书本场景，动作克制可信",
    camera: "缓慢推进到产品/书本和人物表情都清楚的位置",
    emotion: "从思考到确认，避免硬广式夸张表演",
    environment: "关键物件轻微移动，光线稳定",
    ending: "停在产品承接和故事价值都清楚的一帧"
  };
}

function buildChatGptBatchPolicy(shot) {
  if (shot.section === "hook_video") {
    return {
      stage: "首段钩子首帧",
      recommendedBatchSize: "2-4",
      priority: "quality_first",
      reviewFocus: ["钩子强度", "首秒停留", "图生视频可动性", "人物和场景连续性"]
    };
  }
  if (shot.section === "story_image") {
    return {
      stage: "中段叙事图片",
      recommendedBatchSize: "6-12",
      priority: "batch_efficiency",
      reviewFocus: ["故事清晰", "人物连续", "画面无文字", "可做慢速推进"]
    };
  }
  return {
    stage: "后段转化和图书空镜",
    recommendedBatchSize: "3-6",
    priority: "conversion_trust",
    reviewFocus: ["转化可信", "图书空镜无可读文字", "图生视频可动性", "产品感不过硬"]
  };
}

function describeBusinessLineForDreamina(line) {
  const normalized = line.toLowerCase();
  if (normalized.includes("settlement") || normalized.includes("20 million")) {
    return "豪华酒店大堂里出现强烈金钱钩子，年轻男人拖着行李从现金雨中走过，周围服务人员和客人震惊围观，水晶灯和大理石地面突出财富冲击和身份反差";
  }
  if (normalized.includes("hotel") || normalized.includes("breakfast") || normalized.includes("housekeeping") || normalized.includes("shower")) {
    return "高档酒店套房和明亮餐厅里出现强烈金钱钩子，年轻富人身边有飞舞现金和被轻松覆盖的账单，服务人员与客人震惊围观，早餐、整洁床铺和水晶灯突出财富冲击与身份反差";
  }
  if (normalized.includes("interest") || normalized.includes("principal") || normalized.includes("settlement")) {
    return "豪华酒店房间里出现可视化现金雨和发光现金流，成年男人看着酒店账单被自动覆盖，旁边一叠本金保持不动，窗外城市夜景和震惊服务人员突出被动收入的财富冲击";
  }
  if (normalized.includes("real estate") || normalized.includes("houses") || normalized.includes("unit") || normalized.includes("building")) {
    return "房产公司办公室和公寓楼模型场景，年轻销售员低调观察楼盘资料，同事在旁边怀疑议论，画面突出他学习卖房和暗中布局";
  }
  if (normalized.includes("friends") || normalized.includes("relationships") || normalized.includes("gifts")) {
    return "同一个豪车展厅单一镜头里，左侧三位成年富有女性并排站在玻璃桌前，右侧年轻销售员把小礼盒放到桌上，三位买家和销售员人物只出现一次，背景只有一排豪车和吊灯，画面表现关系维护和转介绍成交";
  }
  if (normalized.includes("mercedes") || normalized.includes("brother in law")) {
    return "家庭车库旁边停着一辆豪华旧车，年轻男人和亲戚围绕车价发生克制争执，年长父亲在旁边坚定指点";
  }
  if (normalized.includes("father") || normalized.includes("dad")) {
    return "年长富有父亲在安静书房里给年轻男人讲商业人情规则，两人坐在桌边认真交流，画面像商业导师传授经验";
  }
  if (normalized.includes("ferrari") || normalized.includes("car") || normalized.includes("dealership")) {
    return "豪车展厅中一辆亮眼红色跑车占据视觉中心，年轻销售员和富有女性正在看车，玻璃展厅灯光明亮，画面有高端消费张力";
  }
  if (normalized.includes("wealthy woman") || normalized.includes("impulsive") || normalized.includes("envy")) {
    return "富有女性在豪车展厅露出犹豫又心动的表情，年轻销售员用自信姿态引导成交，周围人只能远远羡慕观看";
  }
  if (normalized.includes("commission") || normalized.includes("prices")) {
    return "销售成交后的商业场景，年轻男人拿着佣金凭证或合同，周围同事和经理震惊沉默，画面突出他靠规则赚钱而不是普通打工";
  }
  return "展示金钱、商业、酒店、房产、豪车展厅或办公室相关的具体场景，让观众不听声音也能理解利益、关系和商业判断";
}

function describeParentingLineForDreamina(line) {
  const normalized = line.toLowerCase();
  if (normalized.includes("paid in u.s. dollars")) {
    return "年轻女性在城市生活场景中显得体面礼貌，手里拿着钱包或付款动作，周围环境暗示她懂规则但内心有压力";
  }
  if (normalized.includes("same mistake")) {
    return "女性站在家门口，外人的行李和问题正要进入她的家，她表情犹豫，室内家人露出担忧神情";
  }
  if (normalized.includes("older mentor")) {
    return "年长导师在客厅里平静地提醒年轻成年人设立边界，年轻人认真倾听，气氛严肃但不是争吵";
  }
  if (normalized.includes("most powerful")) {
    return "一个成年人面对多人请求时保持冷静和坚定，用手势表达拒绝，周围人有压力感但场面克制";
  }
  if (normalized.includes("handle pressure")) {
    return "成年人站在家门口守住边界，身后是家人和温暖室内，门外有人带着行李和请求，形成内外压力对比";
  }
  if (normalized.includes("children to survive")) {
    return "父母在客厅或餐桌旁教育孩子现实判断，孩子认真听，桌上有生活物件和书本，氛围像实用人生课";
  }
  if (normalized.includes("solve problems")) {
    return "孩子在父母引导下自己处理一个小问题，父母没有代替他完成，画面表现独立解决问题";
  }
  if (normalized.includes("hard way")) {
    return "孩子在家庭或街区环境中经历一次现实挑战，表情从困惑转为明白，画面有成长感";
  }
  if (normalized.includes("parents should read")) {
    return "父母在温暖室内看着翻开的空白纸页，旁边孩子在做现实问题练习";
  }
  return "展示父母、孩子、家庭客厅或学习场景，让观众不听声音也能理解家庭教育和边界压力";
}

function translateSubjectTag(subjectTag) {
  if (subjectTag === "person_and_object") return "人物和关键物件同时清楚可见";
  if (subjectTag === "object_or_symbol") return "关键物件或象征物清楚可见";
  return "人物表情和动作清楚可见";
}

function translateCameraForDreamina(camera) {
  if (/slow push-in/i.test(camera)) return "像短视频开头首帧，轻微推进感，画面有电影紧张感";
  return "稳定画面，适合后期在剪映里做缓慢放大或平移";
}

function applyRetryPromptFixes(prompt) {
  const isParentingStory = prompt.storyCategory === "raise_children" && prompt.productCategory === "raise_children";
  if (isParentingStory && prompt.shotId === "S015") {
    return replaceDreaminaScene(prompt, "明亮家庭客厅中景，沙发和餐桌干净可见，成年人站在画面中央认真沟通，前景无遮挡，地面和桌下保持明亮清爽，画面稳定通透");
  }
  if (isParentingStory && prompt.shotId === "S016") {
    return replaceDreaminaScene(prompt, "两位成年人一前一后形成紧张站位，一人后退保护家庭空间，另一人拎包停在门口，靠表情、距离和手势表现冲突");
  }
  return { ...prompt };
}

function replaceDreaminaScene(prompt, scene) {
  const generationPrompt = String(prompt.generationPrompt ?? prompt.imagePrompt).replace(
    /画面内容：[^。]+。/u,
    `画面内容：${scene}。`
  );
  return { ...prompt, generationPrompt };
}

async function generateAndReviewAssets({ packageDir, prompts, config, forceRejectShotIds }) {
  if (config.provider === "dreamina-image" && Number(config.dreamina.concurrency) > 1) {
    const queueResults = await runDreaminaQueue({
      items: prompts,
      concurrency: config.dreamina.concurrency,
      worker: (prompt) => generateAndReviewPrompt({ packageDir, prompt, config, forceRejectShotIds })
    });
    return mergePromptReviewResults(queueResults);
  }

  const promptResults = [];
  for (const prompt of prompts) {
    promptResults.push({
      status: "fulfilled",
      item: prompt,
      value: await generateAndReviewPrompt({ packageDir, prompt, config, forceRejectShotIds })
    });
  }
  return mergePromptReviewResults(promptResults);
}

async function generateAndReviewPrompt({ packageDir, prompt, config, forceRejectShotIds }) {
  const acceptedAssets = [];
  const reviewLines = [];
  const needsManualReview = [];

  let accepted = false;
  let lastReason = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const route = selectProviderRoute(prompt, config);
    let asset;
    try {
      asset = await generateAssetWithProvider({ packageDir, prompt, attempt, route, config });
    } catch (error) {
      if (route.providerName === "dreamina-image") {
        config.dreamina.concurrency = nextDreaminaConcurrency({ current: config.dreamina.concurrency, error });
      }
      const issue = `provider_error: ${formatProviderError(error)}`;
      reviewLines.push(JSON.stringify({
        shotId: prompt.shotId,
        attempt,
        provider: route.providerName,
        storyboardAssetType: prompt.assetType,
        generatedAssetType: route.assetType,
        originalPrompt: prompt.imagePrompt,
        generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
        videoPrompt: prompt.videoPrompt,
        dreaminaVideoPrompt: prompt.dreaminaVideoPrompt,
        issue,
        promptChange: "retry the same prompt once; if the provider keeps failing, inspect provider logs or simplify the provider prompt",
        status: "rejected",
        assetPath: ""
      }));
      lastReason = issue;
      continue;
    }
    const review = reviewAsset(prompt, asset, forceRejectShotIds.has(prompt.shotId));
    reviewLines.push(JSON.stringify({
      shotId: prompt.shotId,
      attempt,
      provider: asset.provider,
      storyboardAssetType: prompt.assetType,
      generatedAssetType: asset.assetType,
      originalPrompt: prompt.imagePrompt,
      generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
      videoPrompt: prompt.videoPrompt,
      dreaminaVideoPrompt: prompt.dreaminaVideoPrompt,
      issue: review.issue,
      promptChange: review.promptChange,
      status: review.status,
      assetPath: asset.relativePath
    }));
    if (review.status === "accepted") {
      acceptedAssets.push({ ...asset, prompt, attempts: attempt, storyboardAssetType: prompt.assetType });
      accepted = true;
      break;
    }
    lastReason = review.issue;
  }
  if (!accepted) {
    needsManualReview.push({
      shotId: prompt.shotId,
      attempts: 3,
      reason: `${lastReason}; manual review required after max retries`,
      prompt: prompt.imagePrompt,
      generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt
      ,
      dreaminaVideoPrompt: prompt.dreaminaVideoPrompt
    });
  }
  return { acceptedAssets, reviewLines, needsManualReview };
}

function mergePromptReviewResults(results) {
  const acceptedAssets = [];
  const reviewLines = [];
  const needsManualReview = [];
  for (const result of results) {
    if (result.status === "rejected") {
      const prompt = result.item;
      const issue = `provider_error: ${formatProviderError(result.reason)}`;
      reviewLines.push(JSON.stringify({
        shotId: prompt.shotId,
        attempt: 1,
        provider: "dreamina-image",
        storyboardAssetType: prompt.assetType,
        generatedAssetType: "image",
        originalPrompt: prompt.imagePrompt,
        generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
        videoPrompt: prompt.videoPrompt,
        issue,
        promptChange: "retry this shot with lower provider concurrency",
        status: "rejected",
        assetPath: ""
      }));
      needsManualReview.push({
        shotId: prompt.shotId,
        attempts: 1,
      reason: `${issue}; manual review required after queue failure`,
      prompt: prompt.imagePrompt,
      generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
      dreaminaVideoPrompt: prompt.dreaminaVideoPrompt
    });
      continue;
    }
    acceptedAssets.push(...result.value.acceptedAssets);
    reviewLines.push(...result.value.reviewLines);
    needsManualReview.push(...result.value.needsManualReview);
  }
  acceptedAssets.sort((left, right) => left.prompt.order - right.prompt.order);
  return { acceptedAssets, reviewLines, needsManualReview };
}

function formatProviderError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").slice(0, 1000);
}

function selectProviderRoute(prompt, config) {
  if (config.provider === "image-mvp") {
    const providerName = config.chatgptShotIds.has(prompt.shotId) ? "chatgpt-web-image2" : "dreamina-image";
    return {
      providerName,
      assetType: "image",
      folder: providerName === "chatgpt-web-image2" ? "03_key_images_chatgpt" : "04_bulk_images_dreamina"
    };
  }
  if (config.provider === "dreamina-image") {
    return {
      providerName: "dreamina-image",
      assetType: "image",
      folder: "04_bulk_images_dreamina"
    };
  }
  if (config.provider === "chatgpt-web-image2") {
    return {
      providerName: "chatgpt-web-image2",
      assetType: "image",
      folder: "03_key_images_chatgpt"
    };
  }
  const isVideo = prompt.assetType === "video" && !config.imageOnly;
  return {
    providerName: "mock",
    assetType: isVideo ? "video" : "image",
    folder: isVideo ? "05_video_clips_dreamina" : config.chatgptShotIds.has(prompt.shotId) ? "03_key_images_chatgpt" : "04_bulk_images_dreamina"
  };
}

function buildChatGptShotIdSet({ totalShots, videoShots, chatgptImageCount, routingPlan }) {
  const count = Math.min(chatgptImageCount, totalShots);
  const orders = new Set();
  const videoCount = Math.min(videoShots, count);
  for (let order = 1; order <= videoCount; order += 1) {
    orders.add(order);
  }
  const remaining = count - orders.size;
  if (remaining > 0) {
    const candidates = buildAnchorOrders(totalShots, videoShots, remaining, routingPlan);
    for (const order of candidates) {
      if (orders.size >= count) break;
      orders.add(order);
    }
  }
  for (let order = 1; orders.size < count && order <= totalShots; order += 1) {
    orders.add(order);
  }
  return new Set([...orders].map((order) => `S${String(order).padStart(3, "0")}`));
}

function buildAnchorOrders(totalShots, videoShots, count, routingPlan) {
  if (routingPlan === "qdhoaudq-43k") {
    const preferred = [25, 32, 40, 48, 56, 64, 73, 76, 80].filter((order) => order <= totalShots && order > videoShots);
    if (preferred.length >= count) return preferred;
  }
  const start = Math.min(totalShots, videoShots + 1);
  const span = Math.max(1, totalShots - start + 1);
  const orders = [];
  for (let index = 0; index < count; index += 1) {
    orders.push(Math.min(totalShots, start + Math.floor((span * index) / count)));
  }
  return [...new Set(orders)];
}

function summarizeRouteCounts(prompts, config) {
  if (config.provider !== "image-mvp") {
    return { chatgptImageShots: 0, dreaminaImageShots: 0 };
  }
  const chatgptImageShots = prompts.filter((prompt) => config.chatgptShotIds.has(prompt.shotId)).length;
  return {
    chatgptImageShots,
    dreaminaImageShots: prompts.length - chatgptImageShots
  };
}

async function generateAssetWithProvider({ packageDir, prompt, attempt, route, config }) {
  const adapter = resolveProviderAdapter(route.providerName, config);
  if (adapter) {
    return adapter.generate({ packageDir, prompt, attempt, folder: route.folder, assetType: route.assetType, provider: route.providerName, config });
  }
  if (route.providerName === "mock") {
    return generateMockAsset(packageDir, prompt, route.providerName, attempt, route);
  }
  if (route.providerName === "dreamina-image") {
    return generateDreaminaImageAsset({ packageDir, prompt, attempt, folder: route.folder, config });
  }
  if (route.providerName === "chatgpt-web-image2") {
    return generateChatGptWebImage2Asset({ packageDir, prompt, attempt, folder: route.folder, config });
  }
  throw new Error(`unsupported provider route: ${route.providerName}`);
}

function resolveProviderAdapter(providerName, config) {
  if (providerName === "chatgpt-web-image2") return config.providerAdapters.chatgptWebImage2;
  if (providerName === "dreamina-image") return config.providerAdapters.dreaminaImage;
  if (providerName === "mock") return config.providerAdapters.mock;
  return undefined;
}

async function generateMockAsset(packageDir, prompt, provider, attempt, route = selectProviderRoute(prompt, { provider: "mock", imageOnly: false, keyImageCount: 3 })) {
  const isVideo = route.assetType === "video";
  const folder = route.folder;
  const extension = isVideo ? "mock-video.txt" : "svg";
  const filename = `${prompt.shotId}_${slugify(prompt.presetId)}_a${attempt}.${extension}`;
  const relativePath = path.join(folder, filename).replaceAll("\\", "/");
  const absolutePath = path.join(packageDir, relativePath);
  const contents = isVideo ? buildMockVideoDescriptor(prompt, provider, attempt) : buildMockSvg(prompt, provider, attempt);
  await writeText(absolutePath, contents);
  return {
    shotId: prompt.shotId,
    assetType: route.assetType,
    provider,
    relativePath,
    absolutePath
  };
}

async function generateDreaminaImageAsset({ packageDir, prompt, attempt, folder, config }) {
  const downloadDir = path.join(packageDir, folder, `${prompt.shotId}_dreamina_a${attempt}_download`);
  await mkdir(downloadDir, { recursive: true });
  const args = buildDreaminaText2ImageArgs({
    prompt: prompt.generationPrompt ?? prompt.imagePrompt,
    dreamina: config.dreamina
  });
  const submitted = await runProviderCommand("dreamina", args);
  const submitId = extractSubmitId(submitted.stdout);
  if (!submitId) {
    throw new Error(`Dreamina did not return a submit_id for ${prompt.shotId}: ${submitted.stdout || submitted.stderr}`);
  }
  const queried = await runProviderCommand("dreamina", [
    "query_result",
    `--submit_id=${submitId}`,
    `--download_dir=${downloadDir}`
  ]);
  const downloaded = await findDownloadedImage(downloadDir);
  if (!downloaded) {
    throw new Error(`Dreamina did not download an image for ${prompt.shotId}: ${queried.stdout || queried.stderr}`);
  }
  const extension = path.extname(downloaded) || ".png";
  const filename = `${prompt.shotId}_dreamina-image_a${attempt}${extension}`;
  const absolutePath = path.join(packageDir, folder, filename);
  await rename(downloaded, absolutePath);
  const metadataPath = absolutePath.replace(extension, ".json");
  await writeJson(metadataPath, {
    provider: "dreamina-image",
    shotId: prompt.shotId,
    attempt,
    submitId,
    prompt: prompt.imagePrompt,
    generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
    stdout: [submitted.stdout, queried.stdout].filter(Boolean).join("\n")
  });
  return {
    shotId: prompt.shotId,
    assetType: "image",
    provider: "dreamina-image",
    relativePath: path.relative(packageDir, absolutePath).replaceAll("\\", "/"),
    absolutePath,
    metadata: { submitId, metadataPath }
  };
}

async function generateChatGptWebImage2Asset({ packageDir, prompt, attempt, folder, config }) {
  const taskDir = path.join(packageDir, "07_review_log", "chatgpt_web_tasks");
  await mkdir(taskDir, { recursive: true });
  const sessionPath = path.join(packageDir, "07_review_log", "chatgpt_session.json");
  const browserSupervisionPolicy = browserSupervisionPolicySummary();
  await writeJson(sessionPath, {
    provider: "chatgpt-web-image2",
    model: "image-2",
    packageSlug: config.slug,
    conversationReuse: "one conversation per script",
    requiredBrowserStep: "explicitly select the ChatGPT image-generation tool in the headed persistent session before sending any image prompt",
    browserSupervisionPolicy,
    maxTemporaryTabs: 1,
    batchPolicy: {
      frontVideoFirstFrames: "2-4 per batch, quality first",
      middleStoryImages: "6-12 per batch after prompts are stable",
      backConversionAndBookBroll: "3-6 per batch",
      fallbackOnQualityIssue: "retry as one image"
    },
    status: "pending-persistent-browser-session"
  });
  await writeJson(path.join(taskDir, `${prompt.shotId}_a${attempt}.json`), {
    provider: "chatgpt-web-image2",
    model: "image-2",
    shotId: prompt.shotId,
    attempt,
    outputFolder: folder,
    imageRole: prompt.imageRole,
    chatgptBatchPolicy: prompt.chatgptBatchPolicy,
    requiredBrowserStep: "select ChatGPT image-generation tool in the headed persistent session first, then send prompt",
    browserSupervisionPolicy,
    prompt: prompt.imagePrompt,
    generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt,
    dreaminaVideoPrompt: prompt.dreaminaVideoPrompt
  });
  throw new Error(
    `chatgpt-web-image2 requires the headed persistent ChatGPT browser session to generate ${prompt.shotId}; task JSON was written for browser execution`
  );
}

function reviewAsset(prompt, asset, forcedReject) {
  if (forcedReject) {
    return {
      status: "rejected",
      issue: "forced test rejection: visual does not meet prompt acceptance criteria",
      promptChange: "tighten scene action, subject focus, and style anchors"
    };
  }
  const hasStyle = /comic|illustration|storyboard|silhouette/i.test(prompt.imagePrompt);
  const hasRatio = /9:16 vertical/i.test(prompt.imagePrompt);
  const hasAsset = Boolean(asset.relativePath);
  const videoFirstFrameReady =
    prompt.assetType !== "video" || /first frame for image-to-video|first-frame image/i.test(prompt.imagePrompt);
  const hasHookStrength =
    prompt.section !== "hook_video" ||
    !/(make_money|business)/.test(String(prompt.storyCategory)) ||
    /(flying cash|cash rain|shocked|stunned|money-status|visible money shock|commission|contract|luxury|status tension|wealthy|surprised)/i.test(prompt.imagePrompt);
  if (hasStyle && hasRatio && hasAsset && hasHookStrength && videoFirstFrameReady) {
    return { status: "accepted", issue: "", promptChange: "" };
  }
  if (!hasHookStrength) {
    return {
      status: "rejected",
      issue: "business hook is semantically accurate but not scroll-stopping enough",
      promptChange: "add visible money shock, flying cash, status contrast, stunned reactions, contracts, or commission symbols"
    };
  }
  return {
    status: "rejected",
    issue: videoFirstFrameReady ? "missing required style, ratio, or asset path" : "video first-frame prompt lacks image-to-video movement readiness",
    promptChange: videoFirstFrameReady
      ? "restore required style block and vertical ratio wording"
      : "add first-frame-for-image-to-video wording, extendable pose, camera direction, and movement potential"
  };
}

function buildEditingManifest(acceptedAssets, config, taxonomy) {
  const shots = acceptedAssets.map((asset) => ({
    shotId: asset.shotId,
    order: asset.prompt.order,
    category: taxonomy.storyCategory,
    storyCategory: taxonomy.storyCategory,
    productCategory: taxonomy.productCategory,
    assetType: asset.assetType,
    storyboardAssetType: asset.storyboardAssetType,
    provider: asset.provider,
    assetPath: asset.relativePath,
    durationSeconds: asset.storyboardAssetType === "video" ? 5 : 3,
    captionText: asset.prompt.line,
      suggestedEdit: buildSuggestedEdit(asset),
      promptPreset: asset.prompt.presetId,
      segmentName: asset.prompt.segmentName,
      operatorSectionName: asset.prompt.operatorSectionName,
      imageRole: asset.prompt.imageRole,
      chatgptBatchPolicy: asset.prompt.chatgptBatchPolicy,
      dreaminaVideoPrompt: asset.prompt.dreaminaVideoPrompt,
      attempts: asset.attempts
    }));
  return {
    generatedAt: config.now.toISOString(),
    mode: config.mode,
    provider: config.provider,
    language: config.language,
    region: config.region,
    category: taxonomy.storyCategory,
    storyCategory: taxonomy.storyCategory,
    productCategory: taxonomy.productCategory,
    storyPreset: taxonomy.storyPreset,
    conversionAngle: taxonomy.conversionAngle,
    routingPlan: config.routingPlan ?? "dynamic",
    notes: [
      "音频、书籍近景、商品实拍、最终字幕样式和 CTA 仍由剪辑师在 CapCut 中手动完成。",
      "ChatGPT 是主要生图工具；即梦第一版重点根据审核通过的 ChatGPT 首帧图生视频。",
      "mock 素材只用于验证本地包结构；登录并确认额度后再替换为 ChatGPT/Dreamina 输出。"
    ],
    shots
  };
}

function buildSuggestedEdit(asset) {
  if (asset.assetType === "video") return "按生成顺序放入钩子或转化视频轨道";
  if (asset.storyboardAssetType === "video") {
    return "作为即梦图生视频首帧；人工复制对应 dreaminaVideoPrompt 生成视频后替换本图";
  }
  if (asset.prompt?.section === "book_broll") return "作为图书空镜或产品替换占位，后续可用实拍书籍近景替换";
  return "在 CapCut 里做慢速缩放或轻微横移";
}

function buildManualCapCutGuide(manifest) {
  return `# CapCut 手动导入指南

Mode: ${manifest.mode}
Provider: ${manifest.provider}
Story category: ${manifest.storyCategory ?? manifest.category}
Product category: ${manifest.productCategory ?? manifest.category}
Conversion angle: ${manifest.conversionAngle ?? ""}

## 导入顺序

1. 先在 ChatGPT 生成并审核 \`03_key_images_chatgpt/\` 的首帧图和叙事图片。
2. 对 \`storyboardAssetType=video\` 的镜头，把审核通过的 ChatGPT 首帧图上传到即梦图生视频，并复制对应 \`dreaminaVideoPrompt\`。
3. 把即梦生成的视频片段放入 \`05_video_clips_dreamina/\`。
4. 中段图片按 \`editing_manifest.csv\` 做慢速缩放或轻微横移。
5. 后段图书空镜可先用 ChatGPT 图，最终可用真人实拍书籍近景替换。
6. 手动加入真人配音、最终字幕、关键词高亮和 CTA。

## 注意事项

- 当前 MVP 不写入 CapCut 草稿。
- 当前 MVP 不依赖 Dreamina 到 CapCut 的账号同步。
- 当前 MVP 不自动运行即梦图生视频；即梦任务需要人工复制 prompt 并确认额度。
- mock 素材只验证包结构；登录并确认额度后再替换为 ChatGPT/即梦输出。
`;
}

function buildCheckpointLog(config, taxonomy, manifest, generation) {
  return `# 流程检查日志

- 目标：把一条 TikTok 脚本生成本地 CapCut 可手动导入素材包。
- Mode: ${config.mode}
- Provider: ${config.provider}
- Story category: ${taxonomy.storyCategory}
- Product category: ${taxonomy.productCategory}
- 已接收镜头：${manifest.shots.length}
- 需要人工复查：${generation.needsManualReview.length}
- Prompt review log: 07_review_log/prompt_iterations.jsonl
- Editing manifest: 06_editing_package/editing_manifest.csv
`;
}

function buildMockSvg(prompt, provider, attempt) {
  const title = escapeXml(`${prompt.shotId} ${prompt.presetLabel}`);
  const line = escapeXml(prompt.line.slice(0, 110));
  const style = escapeXml(prompt.presetId);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#f4d28a"/>
  <rect x="70" y="110" width="940" height="1700" rx="36" fill="#fff7e6" stroke="#1f2937" stroke-width="12"/>
  <circle cx="540" cy="560" r="190" fill="#1f2937"/>
  <rect x="360" y="750" width="360" height="500" rx="140" fill="#1f2937"/>
  <rect x="210" y="1270" width="660" height="190" rx="28" fill="#d9480f"/>
  <text x="540" y="210" font-family="Arial" font-size="54" text-anchor="middle" fill="#111827">${title}</text>
  <text x="540" y="1530" font-family="Arial" font-size="40" text-anchor="middle" fill="#111827">${style}</text>
  <text x="540" y="1610" font-family="Arial" font-size="34" text-anchor="middle" fill="#111827">${line}</text>
  <text x="540" y="1710" font-family="Arial" font-size="30" text-anchor="middle" fill="#374151">mock ${provider}, attempt ${attempt}</text>
</svg>
`;
}

function buildMockVideoDescriptor(prompt, provider, attempt) {
  return [
    `MOCK VIDEO PLACEHOLDER`,
    `shot=${prompt.shotId}`,
    `provider=${provider}`,
    `attempt=${attempt}`,
    `duration=5`,
    `line=${prompt.line}`,
    `video_prompt=${prompt.videoPrompt}`
  ].join("\n") + "\n";
}

function toCsv(rows) {
  const headers = [
    "shotId",
    "order",
    "category",
    "storyCategory",
    "productCategory",
    "assetType",
    "storyboardAssetType",
    "provider",
    "assetPath",
    "durationSeconds",
    "captionText",
    "suggestedEdit",
    "promptPreset",
    "operatorSectionName",
    "imageRole",
    "attempts"
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n") + "\n";
}

async function runProviderCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : "";
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${error.code ?? "unknown"}${stdout}${stderr}`);
  }
}

function extractSubmitId(output) {
  const text = String(output ?? "");
  const jsonMatch = text.match(/"submit_id"\s*:\s*"([^"]+)"/i);
  if (jsonMatch) return jsonMatch[1];
  const labeledMatch = text.match(/submit[_\s-]*id["'\s:=]+([a-zA-Z0-9_-]{8,})/i);
  if (labeledMatch) return labeledMatch[1];
  const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) return uuidMatch[0];
  return "";
}

async function findDownloadedImage(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDownloadedImage(fullPath);
      if (nested) files.push(nested);
    } else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files[0] ?? "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeJson(filePath, value) {
  await writeText(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function maybeReadJson(filePath, shouldRead) {
  if (!shouldRead) return undefined;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function appendJsonLines(filePath, entries) {
  if (!entries.length) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "tiktok-content";
}

function normalizeDreaminaSessionName(value) {
  const normalized = String(value ?? "tiktok-content").trim() || "tiktok-content";
  return normalized.slice(0, 50);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
