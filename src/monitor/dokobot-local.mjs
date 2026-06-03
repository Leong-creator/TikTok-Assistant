import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseCompactNumber } from "./chrome-plugin-bridge.mjs";

const execFileAsync = promisify(execFile);

let cachedLocalDokobotDeviceId = null;

export async function createDokobotFallbackHooks(config = {}) {
  const cliPath = config.dokobotCliPath;
  const deviceId = config.dokobotDeviceId ?? (await resolveDokobotLocalDeviceId({ cliPath }));
  return {
    extractProfileVideosFallback: async ({ account }) =>
      extractProfileVideosWithDokobot({
        profileUrl: account.profileUrl,
        maxVideos: Number(config.maxVideosPerAccount ?? 120),
        screens: Number(config.dokobotProfileScreens ?? 5),
        timeoutSeconds: Number(config.dokobotTimeoutSeconds ?? 120),
        cliPath,
        deviceId
      }),
    extractDirectVideoFallback: async ({ video, primaryResult }) => {
      if (primaryResult?.status !== "login_required" && primaryResult?.status !== "missing_metrics") {
        return primaryResult;
      }
      return extractDirectVideoWithDokobot({
        videoUrl: video.videoUrl,
        accountHandle: video.accountHandle,
        timeoutSeconds: Number(config.dokobotTimeoutSeconds ?? 90),
        cliPath,
        deviceId,
        defaultViews: Number(video.views ?? video.latestViews ?? Number.NaN),
        defaultCaption: video.caption ?? "",
        defaultProductRefs: Array.isArray(video.productRefs) ? video.productRefs : [],
        defaultShares: Number(video.shares ?? 0)
      });
    }
  };
}

export async function extractProfileVideosWithDokobot({
  profileUrl,
  maxVideos = 120,
  screens = 5,
  timeoutSeconds = 120,
  cliPath,
  deviceId
} = {}) {
  const text = await readDokobotText({ url: profileUrl, screens, timeoutSeconds, cliPath, deviceId });
  const videoLinks = parseDokobotProfileVideosText(text).slice(0, maxVideos);
  if (!videoLinks.length) {
    return { status: "missing_metrics", reason: "Dokobot profile read did not expose video links" };
  }
  return { status: "ok", videoLinks, videos: [] };
}

export async function extractDirectVideoWithDokobot({
  videoUrl,
  accountHandle,
  timeoutSeconds = 90,
  cliPath,
  deviceId,
  defaultViews,
  defaultCaption = "",
  defaultProductRefs = [],
  defaultShares = 0
} = {}) {
  const text = await readDokobotText({ url: videoUrl, timeoutSeconds, cliPath, deviceId });
  return parseDokobotVideoDetailText(text, {
    videoUrl,
    accountHandle,
    defaultViews,
    defaultCaption,
    defaultProductRefs,
    defaultShares
  });
}

export function parseDokobotProfileVideosText(text, { maxVideos = Number.POSITIVE_INFINITY } = {}) {
  const body = String(text ?? "");
  const footnoteUrls = new Map(
    [...body.matchAll(/^\[(\d+)\]\s+(https:\/\/www\.tiktok\.com\/@[^/\s]+\/video\/\d+)\s*$/gmu)].map((match) => [
      Number(match[1]),
      match[2]
    ])
  );
  const links = [];
  const seen = new Set();

  for (const match of body.matchAll(/\*\*([^*\n]+?)\s+\[(\d+)\]\*\*/gmu)) {
    const ref = Number(match[2]);
    const videoUrl = footnoteUrls.get(ref);
    if (!videoUrl || seen.has(videoUrl)) continue;
    links.push({
      videoUrl,
      views: parseCompactCount(match[1])
    });
    seen.add(videoUrl);
    if (links.length >= maxVideos) return links;
  }

  for (const match of body.matchAll(/https:\/\/www\.tiktok\.com\/@[^/\s]+\/video\/\d+/gmu)) {
    const videoUrl = match[0];
    if (seen.has(videoUrl)) continue;
    links.push({ videoUrl, views: 0 });
    seen.add(videoUrl);
    if (links.length >= maxVideos) return links;
  }

  return links;
}

export function parseDokobotVideoDetailText(
  text,
  {
    videoUrl,
    accountHandle,
    defaultViews,
    defaultCaption = "",
    defaultProductRefs = [],
    defaultShares = 0
  } = {}
) {
  const body = String(text ?? "");
  const likesMatch = body.match(/\*\*点赞视频\*\*\s*\*\*([^*\n]+?)\s*个赞\*\*/u);
  const commentsMatch = body.match(/\*\*阅读或添加评论\*\*\s*\*\*([^*\n]+?)\s*条评论\*\*/u);
  const likes = likesMatch ? parseCompactCount(likesMatch[1]) : Number.NaN;
  const comments = commentsMatch ? parseCompactCount(commentsMatch[1]) : Number.NaN;
  const views = Number.isFinite(Number(defaultViews)) ? Number(defaultViews) : Number.NaN;

  if (!Number.isFinite(likes) || !Number.isFinite(comments) || !Number.isFinite(views)) {
    return { status: "missing_metrics", reason: "Dokobot detail read did not expose stable video metrics" };
  }

  return {
    status: "ok",
    video: {
      accountHandle,
      videoUrl,
      views,
      likes,
      comments,
      shares: Number.isFinite(Number(defaultShares)) ? Number(defaultShares) : 0,
      caption: defaultCaption,
      postedAt: undefined,
      productRefs: Array.isArray(defaultProductRefs) ? defaultProductRefs : []
    }
  };
}

export async function readDokobotText({ url, screens, timeoutSeconds = 90, cliPath, deviceId } = {}) {
  const bin = cliPath ? path.resolve(cliPath) : resolveDokobotCliPath();
  const localDeviceId = deviceId ?? (await resolveDokobotLocalDeviceId({ cliPath: bin }));
  const args = ["read", "--local", "--device", localDeviceId, "--timeout", String(timeoutSeconds), "--format", "text"];
  if (Number.isFinite(Number(screens)) && Number(screens) > 0) {
    args.push("--screens", String(Number(screens)));
  }
  args.push(String(url));
  const { stdout } = await execFileAsync(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

export async function resolveDokobotLocalDeviceId({ cliPath } = {}) {
  if (cachedLocalDokobotDeviceId) return cachedLocalDokobotDeviceId;
  const bin = cliPath ? path.resolve(cliPath) : resolveDokobotCliPath();
  const { stdout } = await execFileAsync(bin, ["doko", "list"], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const match = stdout.match(/Local:\s*[\r\n]+\s*([0-9a-f-]{36})\s+/iu);
  if (!match?.[1]) {
    throw new Error("Dokobot local browser device is not available");
  }
  cachedLocalDokobotDeviceId = match[1];
  return cachedLocalDokobotDeviceId;
}

export function resolveDokobotCliPath() {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", "npm", "dokobot.cmd");
  }
  return "dokobot";
}

function parseCompactCount(value) {
  const parsed = parseCompactNumber(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
