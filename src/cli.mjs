#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { generateAssetPackage, retryPackageShots } from "./pipeline.mjs";

const args = parseArgs(process.argv.slice(2));

if (args["retry-package"]) {
  const result = await retryPackageShots({
    packageDir: path.resolve(args["retry-package"]),
    shots: parseShotList(args.shots),
    provider: args.provider ?? "dreamina-image",
    dreamina: {
      modelVersion: args["dreamina-model-version"],
      resolutionType: args["dreamina-resolution-type"],
      pollSeconds: args["dreamina-poll-seconds"] ? Number(args["dreamina-poll-seconds"]) : undefined,
      sessionId: args["dreamina-session-id"],
      sessionName: args["dreamina-session"],
      concurrency: args["dreamina-concurrency"] ? Number(args["dreamina-concurrency"]) : undefined
    }
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (!args.script) {
  console.error(
    "Usage: node src/cli.mjs --script <file> [--slug name] [--mode test|standard|full] [--provider mock|dreamina-image|chatgpt-web-image2|image-mvp] [--image-only]\n" +
      "Retry: node src/cli.mjs --retry-package <folder> --shots S015,S016 [--provider dreamina-image]"
  );
  process.exit(2);
}

const script = await readFile(path.resolve(args.script), "utf8");
const result = await generateAssetPackage({
  script,
  outputRoot: path.resolve(args.output ?? "outputs"),
  slug: args.slug ?? path.basename(args.script, path.extname(args.script)),
  mode: args.mode ?? "test",
  provider: args.provider ?? "mock",
  imageOnly: Boolean(args["image-only"]),
  keyImageCount: args["key-image-count"] ? Number(args["key-image-count"]) : undefined,
  totalShots: args["total-shots"] ? Number(args["total-shots"]) : undefined,
  videoShots: args["video-shots"] ? Number(args["video-shots"]) : undefined,
  chatgptImageCount: args["chatgpt-image-count"] ? Number(args["chatgpt-image-count"]) : undefined,
  routingPlan: args["routing-plan"],
  storyCategory: args["story-category"],
  productCategory: args["product-category"],
  conversionAngle: args["conversion-angle"],
  dreamina: {
    modelVersion: args["dreamina-model-version"],
    resolutionType: args["dreamina-resolution-type"],
    pollSeconds: args["dreamina-poll-seconds"] ? Number(args["dreamina-poll-seconds"]) : undefined,
    sessionId: args["dreamina-session-id"],
    sessionName: args["dreamina-session"],
    concurrency: args["dreamina-concurrency"] ? Number(args["dreamina-concurrency"]) : undefined
  },
  resumeFrom: args["resume-from"],
  language: args.language ?? "en-US",
  region: args.region ?? "United States"
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseShotList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
