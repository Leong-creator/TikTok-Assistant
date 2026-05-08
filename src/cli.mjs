#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { generateAssetPackage } from "./pipeline.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.script) {
  console.error("Usage: node src/cli.mjs --script <file> [--slug name] [--mode test|standard|full] [--provider mock]");
  process.exit(2);
}

const script = await readFile(path.resolve(args.script), "utf8");
const result = await generateAssetPackage({
  script,
  outputRoot: path.resolve(args.output ?? "outputs"),
  slug: args.slug ?? path.basename(args.script, path.extname(args.script)),
  mode: args.mode ?? "test",
  provider: args.provider ?? "mock",
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
