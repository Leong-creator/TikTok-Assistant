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
  test: { totalShots: 20, videoShots: 5 },
  standard: { totalShots: 40, videoShots: 12 },
  full: { totalShots: 80, videoShots: 24 }
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
      generationPrompt: entry.generationPrompt
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
    normalizeCount(options.chatgptImageCount ?? options.keyImageCount, options.keyImageCount ? Number(options.keyImageCount) : 3, "chatgptImageCount"),
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
  const conversionShots = Math.min(totalShots, Math.max(4, Math.round(totalShots * 0.1)));

  for (let index = 0; index < totalShots; index += 1) {
    const shotNumber = index + 1;
    const id = `S${String(shotNumber).padStart(3, "0")}`;
    const sentence = usableLines[index % usableLines.length];
    const assetType = shotNumber <= videoShots ? "video" : "image";
    const section = shotNumber <= videoShots ? "hook_video" : shotNumber > totalShots - conversionShots ? "conversion" : "story_image";
    shots.push({
      id,
      order: shotNumber,
      category: taxonomy.storyCategory,
      storyCategory: taxonomy.storyCategory,
      productCategory: taxonomy.productCategory,
      conversionAngle: taxonomy.conversionAngle,
      section,
      assetType,
      durationSeconds: assetType === "video" ? 5 : 3,
      line: sentence,
      subjectTag: chooseSubjectTag(sentence),
      visualBeat: buildVisualBeat(sentence, section, taxonomy)
    });
  }

  return shots;
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
  if (section === "conversion") {
    if (taxonomy.productCategory === "raise_children") {
      return `Convert the money story into a parent and children financial literacy scene about real-world judgment, relationships, and practical decision making: "${sentence}".`;
    }
    return `Connect the lesson to a book or product moment while preserving the story context: "${sentence}".`;
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
  const imagePrompt = [
    `${BASE_VISUAL_STYLE}. ${preset.style}.`,
    "9:16 vertical composition, single coherent scene, no collage panels, no Chinese text.",
    `Shot ${shot.id}: ${shot.visualBeat}`,
    `Subject tag: ${shot.subjectTag}.`,
    `Camera: ${camera}.`,
    "Include clear adult character actions, expressive micro-emotions, US-local environment details, warm cinematic light, and full-frame vertical storytelling with no artificial blank bands."
  ].join(" ");
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
  const videoPrompt = [
    "Animate this image as a short TikTok story beat.",
    "Use smooth camera movement, subtle character motion, natural lighting change, and no added text.",
    `Preserve the image style and story intent: ${shot.visualBeat}`
  ].join(" ");

  return {
    shotId: shot.id,
    order: shot.order,
    section: shot.section,
    presetId,
    presetLabel: preset.label,
    assetType: shot.assetType,
    storyCategory: taxonomy.storyCategory,
    productCategory: taxonomy.productCategory,
    conversionAngle: taxonomy.conversionAngle,
    line: shot.line,
    visualBeat: shot.visualBeat,
    imagePrompt,
    generationPrompt,
    videoPrompt
  };
}

function choosePresetForShot(shot, taxonomy) {
  if (shot.section === "conversion" && taxonomy.productCategory === "raise_children") return "parenting-book";
  if (taxonomy.storyPreset) return taxonomy.storyPreset;
  return CATEGORY_PRESETS[taxonomy.storyCategory] ?? CATEGORY_PRESETS.default;
}

function buildDreaminaStyleLine(shot, taxonomy) {
  if (shot.section === "conversion" && taxonomy.productCategory === "raise_children") {
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
    shot.section === "conversion" && taxonomy.productCategory === "raise_children"
      ? "环境要像温暖的美国家庭学习空间"
      : taxonomy.storyCategory === "make_money" || taxonomy.storyCategory === "business"
        ? "环境要像美国高端酒店、房产办公室、豪车展厅或富人书房"
        : taxonomy.storyCategory === "raise_children"
          ? "环境要像美国普通家庭住宅"
          : "环境要像美国现实生活空间";
  return `人物动作要清楚，情绪要一眼可读，${environment}，主体和关键环境从上到下都有内容，构图要全画幅叙事，画面铺满。`;
}

function translateVisualBeatForDreamina(shot) {
  if (shot.section === "conversion" && shot.productCategory === "raise_children") {
    return "父母把赚钱故事里的规则讲给孩子听，孩子在旁边认真思考，桌上有翻开的空白纸页和生活物件，画面表达财商、人情世故和现实判断的教育承接";
  }
  if (shot.id === "S015") {
    return "明亮家庭客厅中景，沙发和餐桌干净可见，成年人站在画面中央认真沟通，前景无遮挡，地面和桌下保持明亮清爽，画面稳定通透";
  }
  if (shot.id === "S016") {
    return "两位成年人一前一后形成紧张站位，一人后退保护家庭空间，另一人拎包停在门口，靠表情、距离和手势表现冲突";
  }
  if (shot.section === "hook_video") {
    if (shot.storyCategory === "make_money" || shot.storyCategory === "business") {
      return describeBusinessLineForDreamina(shot.line);
    }
    return `用明显的家庭冲突开场，成年人围绕家庭边界、亲戚照顾和家中压力发生克制但紧张的对峙，画面只表现情境`;
  }
  if (shot.section === "conversion") {
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
  if (prompt.shotId === "S015") {
    return replaceDreaminaScene(prompt, "明亮家庭客厅中景，沙发和餐桌干净可见，成年人站在画面中央认真沟通，前景无遮挡，地面和桌下保持明亮清爽，画面稳定通透");
  }
  if (prompt.shotId === "S016") {
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
        generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt
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
  await writeJson(sessionPath, {
    provider: "chatgpt-web-image2",
    model: "image-2",
    packageSlug: config.slug,
    conversationReuse: "one conversation per script",
    maxTemporaryTabs: 1,
    batchPolicy: {
      initial: 3,
      stable: 5,
      maximum: 10,
      fallbackOnQualityIssue: 1
    },
    status: "pending-browser-adapter"
  });
  await writeJson(path.join(taskDir, `${prompt.shotId}_a${attempt}.json`), {
    provider: "chatgpt-web-image2",
    model: "image-2",
    shotId: prompt.shotId,
    attempt,
    outputFolder: folder,
    prompt: prompt.imagePrompt,
    generationPrompt: prompt.generationPrompt ?? prompt.imagePrompt
  });
  throw new Error(
    `chatgpt-web-image2 requires the Codex Chrome browser adapter to generate ${prompt.shotId}; task JSON was written for browser execution`
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
  const hasHookStrength =
    prompt.section !== "hook_video" ||
    !/(make_money|business)/.test(String(prompt.storyCategory)) ||
    /(flying cash|cash rain|shocked|stunned|money-status|visible money shock|commission|contract|luxury|status tension|wealthy|surprised)/i.test(prompt.imagePrompt);
  if (hasStyle && hasRatio && hasAsset && hasHookStrength) {
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
    issue: "missing required style, ratio, or asset path",
    promptChange: "restore required style block and vertical ratio wording"
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
      "Audio, book close-ups, product real shots, final subtitle styling, and CTA are manual CapCut work for MVP.",
      "Mock provider assets prove package shape only; replace with ChatGPT/Dreamina provider outputs after login."
    ],
    shots
  };
}

function buildSuggestedEdit(asset) {
  if (asset.assetType === "video") return "place as generated hook/story video";
  if (asset.storyboardAssetType === "video") {
    return "use as first frame for future image-to-video; for this image-only test, apply slow push-in in CapCut";
  }
  return "apply slow zoom or slight horizontal pan in CapCut";
}

function buildManualCapCutGuide(manifest) {
  return `# Manual CapCut Import Guide

Mode: ${manifest.mode}
Provider: ${manifest.provider}
Story category: ${manifest.storyCategory ?? manifest.category}
Product category: ${manifest.productCategory ?? manifest.category}
Conversion angle: ${manifest.conversionAngle ?? ""}

## Import order

1. Import the generated video clips from \`05_video_clips_dreamina/\`.
2. Import key images from \`03_key_images_chatgpt/\`.
3. Import bulk images from \`04_bulk_images_dreamina/\`.
4. Sort by filename, then place assets according to \`editing_manifest.csv\`.
5. For image assets, apply a slow zoom or slight pan for the listed duration.
6. Add human-created voiceover and book/product close-up shots.
7. Add final captions and keyword highlights manually.

## Notes

- This MVP does not write a CapCut draft.
- This MVP does not depend on Dreamina-to-CapCut sync.
- Replace mock assets with real provider outputs when ChatGPT/Dreamina login is available.
`;
}

function buildCheckpointLog(config, taxonomy, manifest, generation) {
  return `# Checkpoint Log

- Goal: Generate a local CapCut-ready asset folder from one TikTok script.
- Mode: ${config.mode}
- Provider: ${config.provider}
- Story category: ${taxonomy.storyCategory}
- Product category: ${taxonomy.productCategory}
- Shots accepted: ${manifest.shots.length}
- Manual review items: ${generation.needsManualReview.length}
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
