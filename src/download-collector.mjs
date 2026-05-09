import { appendFile, mkdir, readdir, rename, stat } from "node:fs/promises";
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
