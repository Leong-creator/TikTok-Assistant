import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function upsertPackageIndex({ outputRoot, entry }) {
  const indexPath = path.join(outputRoot, ".index.json");
  const index = await readPackageIndex(outputRoot);
  const normalizedEntry = {
    ...entry,
    path: path.resolve(entry.path),
    updatedAt: new Date().toISOString()
  };
  const existingIndex = index.packages.findIndex((item) => path.resolve(item.path) === normalizedEntry.path);
  if (existingIndex >= 0) {
    index.packages[existingIndex] = { ...index.packages[existingIndex], ...normalizedEntry };
  } else {
    index.packages.push(normalizedEntry);
  }
  index.packages.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  await mkdir(outputRoot, { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

export async function readPackageIndex(outputRoot) {
  const indexPath = path.join(outputRoot, ".index.json");
  try {
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    return {
      version: 1,
      packages: Array.isArray(index.packages) ? index.packages : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, packages: [] };
  }
}
