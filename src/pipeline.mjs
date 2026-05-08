import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
      "American family education illustration, school and home scenes, parent-child interaction, warm daylight, clean educational book-commercial framing, wholesome emotional expressions",
    usage: "children and parenting book scripts"
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
  const modeConfig = MODES[config.mode];
  const packageDir = path.join(config.outputRoot, `${formatLocalDate(config.now)}-${config.slug}`);
  await createPackageDirectories(packageDir);

  const originalScript = config.script.trim();
  const category = config.category ?? inferCategory(originalScript);
  const localizedScript = localizeScript(originalScript, config.language, config.region);
  const shots = buildStoryboard(localizedScript, modeConfig.totalShots, modeConfig.videoShots, category);
  const prompts = shots.map((shot) => buildPromptForShot(shot, category));

  await writeText(path.join(packageDir, "00_script/original.txt"), originalScript + "\n");
  await writeText(path.join(packageDir, "00_script/localized.txt"), localizedScript + "\n");
  await writeJson(path.join(packageDir, "01_storyboard/storyboard.json"), shots);
  await writeJson(path.join(packageDir, "02_prompts/prompts.json"), prompts);

  const generation = await generateAndReviewAssets({
    packageDir,
    prompts,
    provider: config.provider,
    forceRejectShotIds: config.forceRejectShotIds
  });

  const manifest = buildEditingManifest(generation.acceptedAssets, config, category);
  await writeJson(path.join(packageDir, "06_editing_package/editing_manifest.json"), manifest);
  await writeText(path.join(packageDir, "06_editing_package/editing_manifest.csv"), toCsv(manifest.shots));
  await writeText(path.join(packageDir, "06_editing_package/manual_capcut_steps.md"), buildManualCapCutGuide(manifest));
  await writeText(path.join(packageDir, "07_review_log/prompt_iterations.jsonl"), generation.reviewLines.join("\n") + "\n");
  await writeJson(path.join(packageDir, "07_review_log/needs_manual_review.json"), generation.needsManualReview);
  await writeText(path.join(packageDir, "07_review_log/checkpoint_log.md"), buildCheckpointLog(config, category, manifest, generation));

  return {
    packageDir,
    summary: {
      mode: config.mode,
      provider: config.provider,
      category,
      totalShots: shots.length,
      videoShots: shots.filter((shot) => shot.assetType === "video").length,
      imageShots: shots.filter((shot) => shot.assetType === "image").length,
      manualReview: generation.needsManualReview.length
    }
  };
}

export async function generateAssetPackageFromFile(options) {
  const script = await readFile(options.scriptPath, "utf8");
  return generateAssetPackage({ ...options, script });
}

function normalizeOptions(options) {
  if (!options?.script || !options.script.trim()) {
    throw new Error("script is required");
  }
  const mode = options.mode ?? "test";
  if (!MODES[mode]) {
    throw new Error(`unsupported mode: ${mode}`);
  }
  return {
    script: options.script,
    outputRoot: options.outputRoot ?? path.resolve("outputs"),
    slug: slugify(options.slug ?? "tiktok-content"),
    mode,
    provider: options.provider ?? "mock",
    now: options.now ?? new Date(),
    language: options.language ?? "en-US",
    region: options.region ?? "United States",
    category: options.category,
    forceRejectShotIds: new Set(options.forceRejectShotIds ?? [])
  };
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

function inferCategory(script) {
  const text = script.toLowerCase();
  if (/(child|children|kid|parent|school|raise|family|teacher)/.test(text)) return "raise_children";
  if (/(people skill|social|friend|relationship|office|meeting|conversation)/.test(text)) return "people_skill";
  if (/(money|wealth|rich|cash|debt|business|hotel|rent|bill|system)/.test(text)) return "make_money";
  return "default";
}

function localizeScript(script, language, region) {
  const normalized = splitSentences(script).join("\n");
  return [
    `[Localized draft: ${language}, ${region}]`,
    "Keep the book title unchanged. Replace culturally specific details with locally plausible US examples.",
    normalized
  ].join("\n");
}

function splitSentences(script) {
  return script
    .replace(/\r/g, "")
    .split(/\n|(?<=[.!?。！？])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildStoryboard(script, totalShots, videoShots, category) {
  const scriptLines = splitSentences(script).filter(
    (line) =>
      !line.startsWith("[Localized draft:") &&
      !line.startsWith("Keep the book title unchanged.") &&
      !line.startsWith("Replace culturally specific details")
  );
  const usableLines = scriptLines.length ? scriptLines : ["A compelling TikTok product story unfolds."];
  const shots = [];

  for (let index = 0; index < totalShots; index += 1) {
    const shotNumber = index + 1;
    const id = `S${String(shotNumber).padStart(3, "0")}`;
    const sentence = usableLines[index % usableLines.length];
    const assetType = shotNumber <= videoShots ? "video" : "image";
    const section = shotNumber <= videoShots ? "hook_video" : shotNumber > totalShots - 4 ? "conversion" : "story_image";
    shots.push({
      id,
      order: shotNumber,
      category,
      section,
      assetType,
      durationSeconds: assetType === "video" ? 5 : 3,
      line: sentence,
      subjectTag: chooseSubjectTag(sentence),
      visualBeat: buildVisualBeat(sentence, section, category)
    });
  }

  return shots;
}

function chooseSubjectTag(sentence) {
  if (/(book|page|cover|cash|bill|car|room|phone|contract)/i.test(sentence)) return "person_and_object";
  if (/(system|truth|lesson|difference|idea|mindset)/i.test(sentence)) return "object_or_symbol";
  return "person";
}

function buildVisualBeat(sentence, section, category) {
  if (section === "hook_video") {
    return `Open with visible conflict: adult characters react strongly to the idea "${sentence}".`;
  }
  if (section === "conversion") {
    return `Connect the lesson to a book or product moment while preserving the story context: "${sentence}".`;
  }
  if (category === "raise_children") {
    return `Show a parent, child, classroom or home-learning moment that makes the line understandable without audio: "${sentence}".`;
  }
  if (category === "people_skill") {
    return `Show adult social tension, office body language or public interaction that embodies the line: "${sentence}".`;
  }
  return `Show a concrete money, business, hotel, car or office scene that embodies the line: "${sentence}".`;
}

function buildPromptForShot(shot, category) {
  const presetId = CATEGORY_PRESETS[category] ?? CATEGORY_PRESETS.default;
  const preset = PRESETS[presetId];
  const camera = shot.assetType === "video" ? "slow push-in, subtle parallax, cinematic handheld tension" : "stable frame for Ken Burns zoom";
  const imagePrompt = [
    `${BASE_VISUAL_STYLE}. ${preset.style}.`,
    "9:16 vertical composition, single coherent scene, no collage panels, no Chinese text.",
    `Shot ${shot.id}: ${shot.visualBeat}`,
    `Subject tag: ${shot.subjectTag}.`,
    `Camera: ${camera}.`,
    "Include clear adult character actions, expressive micro-emotions, US-local environment details, warm cinematic light, and clean center space for captions."
  ].join(" ");
  const videoPrompt = [
    "Animate this image as a short TikTok story beat.",
    "Use smooth camera movement, subtle character motion, natural lighting change, and no added text.",
    `Preserve the image style and story intent: ${shot.visualBeat}`
  ].join(" ");

  return {
    shotId: shot.id,
    order: shot.order,
    presetId,
    presetLabel: preset.label,
    assetType: shot.assetType,
    line: shot.line,
    imagePrompt,
    videoPrompt
  };
}

async function generateAndReviewAssets({ packageDir, prompts, provider, forceRejectShotIds }) {
  const acceptedAssets = [];
  const reviewLines = [];
  const needsManualReview = [];

  for (const prompt of prompts) {
    let accepted = false;
    let lastReason = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const asset = await generateMockAsset(packageDir, prompt, provider, attempt);
      const review = reviewAsset(prompt, asset, forceRejectShotIds.has(prompt.shotId));
      reviewLines.push(JSON.stringify({
        shotId: prompt.shotId,
        attempt,
        provider,
        originalPrompt: prompt.imagePrompt,
        videoPrompt: prompt.videoPrompt,
        issue: review.issue,
        promptChange: review.promptChange,
        status: review.status,
        assetPath: asset.relativePath
      }));
      if (review.status === "accepted") {
        acceptedAssets.push({ ...asset, prompt, attempts: attempt });
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
        prompt: prompt.imagePrompt
      });
    }
  }

  return { acceptedAssets, reviewLines, needsManualReview };
}

async function generateMockAsset(packageDir, prompt, provider, attempt) {
  const isVideo = prompt.assetType === "video";
  const folder = isVideo ? "05_video_clips_dreamina" : prompt.order <= 3 ? "03_key_images_chatgpt" : "04_bulk_images_dreamina";
  const extension = isVideo ? "mock-video.txt" : "svg";
  const filename = `${prompt.shotId}_${slugify(prompt.presetId)}_a${attempt}.${extension}`;
  const relativePath = path.join(folder, filename).replaceAll("\\", "/");
  const absolutePath = path.join(packageDir, relativePath);
  const contents = isVideo ? buildMockVideoDescriptor(prompt, provider, attempt) : buildMockSvg(prompt, provider, attempt);
  await writeText(absolutePath, contents);
  return {
    shotId: prompt.shotId,
    assetType: prompt.assetType,
    provider,
    relativePath,
    absolutePath
  };
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
  if (hasStyle && hasRatio && hasAsset) {
    return { status: "accepted", issue: "", promptChange: "" };
  }
  return {
    status: "rejected",
    issue: "missing required style, ratio, or asset path",
    promptChange: "restore required style block and vertical ratio wording"
  };
}

function buildEditingManifest(acceptedAssets, config, category) {
  const shots = acceptedAssets.map((asset) => ({
    shotId: asset.shotId,
    order: asset.prompt.order,
    category,
    assetType: asset.assetType,
    assetPath: asset.relativePath,
    durationSeconds: asset.assetType === "video" ? 5 : 3,
    captionText: asset.prompt.line,
    suggestedEdit: asset.assetType === "video" ? "place as generated hook/story video" : "apply slow zoom or slight horizontal pan in CapCut",
    promptPreset: asset.prompt.presetId,
    attempts: asset.attempts
  }));
  return {
    generatedAt: config.now.toISOString(),
    mode: config.mode,
    provider: config.provider,
    language: config.language,
    region: config.region,
    category,
    notes: [
      "Audio, book close-ups, product real shots, final subtitle styling, and CTA are manual CapCut work for MVP.",
      "Mock provider assets prove package shape only; replace with ChatGPT/Dreamina provider outputs after login."
    ],
    shots
  };
}

function buildManualCapCutGuide(manifest) {
  return `# Manual CapCut Import Guide

Mode: ${manifest.mode}
Provider: ${manifest.provider}
Category: ${manifest.category}

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

function buildCheckpointLog(config, category, manifest, generation) {
  return `# Checkpoint Log

- Goal: Generate a local CapCut-ready asset folder from one TikTok script.
- Mode: ${config.mode}
- Provider: ${config.provider}
- Category: ${category}
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
    "assetType",
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeJson(filePath, value) {
  await writeText(filePath, JSON.stringify(value, null, 2) + "\n");
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
