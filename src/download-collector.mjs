import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function snapshotDownloadDirectory(downloadDir) {
  const files = await listFiles(downloadDir);
  return new Set(files.map((file) => file.absolutePath));
}

export async function collectDownloadedImages(options) {
  const downloadDir = options.downloadDir;
  const beforeSnapshot = options.beforeSnapshot ?? new Set();
  const packageDir = options.packageDir;
  const folder = options.folder;
  const assignments = options.assignments ?? [];
  const logPath = options.logPath;

  const files = await listFiles(downloadDir);
  const newImages = files
    .filter((file) => !beforeSnapshot.has(file.absolutePath))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));

  const moved = [];
  const count = Math.min(newImages.length, assignments.length);
  for (let index = 0; index < count; index += 1) {
    const source = newImages[index];
    const assignment = assignments[index];
    const extension = path.extname(source.name).toLowerCase() || ".png";
    const filename = `${assignment.shotId}_${assignment.provider}_a${assignment.attempt}${extension}`;
    const target = path.join(packageDir, folder, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source.absolutePath, target);
    const entry = {
      timestamp: new Date().toISOString(),
      shotId: assignment.shotId,
      provider: assignment.provider,
      attempt: assignment.attempt,
      from: source.absolutePath,
      to: target
    };
    moved.push(entry);
    if (logPath) {
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
    }
  }

  return moved;
}

export async function applyCollectedImagesToManifest(options) {
  const packageDir = options.packageDir;
  const moved = options.moved ?? [];
  const manifestPath = path.join(packageDir, "06_editing_package", "editing_manifest.json");
  const csvPath = path.join(packageDir, "06_editing_package", "editing_manifest.csv");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const updates = [];

  for (const item of moved) {
    const shot = manifest.shots.find((candidate) => candidate.shotId === item.shotId);
    if (!shot) continue;
    const relativePath = path.relative(packageDir, item.to).replaceAll("\\", "/");
    shot.provider = item.provider;
    shot.assetPath = relativePath;
    shot.assetType = "image";
    shot.attempts = item.attempt;
    updates.push({
      shotId: item.shotId,
      provider: item.provider,
      assetPath: relativePath,
      attempts: item.attempt
    });
  }

  if (updates.length > 0) {
    const providers = new Set(manifest.shots.map((shot) => shot.provider));
    if (providers.size > 1) {
      manifest.provider = "mixed";
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await writeFile(csvPath, toManifestCsv(manifest.shots), "utf8");
  }

  return updates;
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(absolutePath);
    files.push({
      name: entry.name,
      absolutePath,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size
    });
  }
  return files;
}

function toManifestCsv(rows) {
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
