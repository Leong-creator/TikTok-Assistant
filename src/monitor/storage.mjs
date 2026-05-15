import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureMonitorDataDirs(dataDir) {
  await Promise.all(
    ["seeds", "snapshots", "signals", "alerts", "leads", "state"].map((dir) =>
      mkdir(path.join(dataDir, dir), { recursive: true })
    )
  );
}

export async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function appendJsonLines(filePath, entries) {
  if (!entries.length) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
}

export async function readJsonLines(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
