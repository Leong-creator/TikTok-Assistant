import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLarkCliInvocation,
  importSeedsFromFeishuWiki,
  importSeedsFromText,
  promoteAccountCandidates
} from "../src/monitor/seed-importer.mjs";

test("buildLarkCliInvocation wraps lark-cli through cmd.exe on Windows", () => {
  const invocation = buildLarkCliInvocation({
    platform: "win32",
    larkCliPath: "lark-cli.cmd",
    args: ["docs", "+fetch"]
  });

  assert.equal(invocation.command, "cmd.exe");
  assert.deepEqual(invocation.args, ["/d", "/s", "/c", "lark-cli.cmd", "docs", "+fetch"]);
});

test("buildLarkCliInvocation quotes absolute Windows lark-cli paths", () => {
  const invocation = buildLarkCliInvocation({
    platform: "win32",
    larkCliPath: "C:\\Users\\EDY\\AppData\\Roaming\\npm\\lark-cli.cmd",
    args: ["docs", "+fetch"]
  });

  assert.equal(invocation.command, "cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "\"C:\\Users\\EDY\\AppData\\Roaming\\npm\\lark-cli.cmd\"",
    "docs",
    "+fetch"
  ]);
});

test("importSeedsFromText extracts TikTok accounts and shops from exported Feishu text", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-seeds-"));
  try {
    const result = await importSeedsFromText({
      dataDir,
      text: `
        https://www.tiktok.com/@book_alpha
        https://www.tiktok.com/@book_alpha/video/735111
        https://www.tiktok.com/@book_beta
        https://www.tiktok.com/shop/alpha-books
        https://www.tiktok.com/t/ZTk7Hm8ro/
      `
    });

    assert.equal(result.accounts, 2);
    assert.equal(result.shops, 1);
    assert.equal(result.videos, 2);

    const accounts = JSON.parse(await readFile(path.join(dataDir, "seeds", "accounts.json"), "utf8"));
    assert.deepEqual(accounts.map((account) => account.handle), ["book_alpha", "book_beta"]);

    const shops = JSON.parse(await readFile(path.join(dataDir, "seeds", "shops.json"), "utf8"));
    assert.equal(shops[0].shopUrl, "https://www.tiktok.com/shop/alpha-books");

    const videos = JSON.parse(await readFile(path.join(dataDir, "seeds", "videos.json"), "utf8"));
    assert.deepEqual(videos.map((video) => video.videoUrl), [
      "https://www.tiktok.com/@book_alpha/video/735111",
      "https://www.tiktok.com/t/ZTk7Hm8ro"
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("importSeedsFromFeishuWiki supports exported file fallback", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-seeds-file-"));
  try {
    const exportPath = path.join(dataDir, "wiki-export.txt");
    await mkdir(dataDir, { recursive: true });
    await writeFile(exportPath, "https://www.tiktok.com/@book_alpha\nhttps://www.tiktok.com/shop/alpha-books\n");

    const result = await importSeedsFromFeishuWiki({
      dataDir,
      url: "https://gah4srxbgfr.feishu.cn/wiki/example",
      fromFile: exportPath
    });

    assert.equal(result.accounts, 1);
    assert.equal(result.shops, 1);
    assert.equal(result.source, "file");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("promoteAccountCandidates moves candidate accounts into the formal tracking pool", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-promote-candidates-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-book_alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          enabled: true
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify([
        {
          id: "candidate-book_alpha",
          handle: "book_alpha",
          profileUrl: "https://www.tiktok.com/@book_alpha",
          status: "candidate",
          sourceQuery: "people skill",
          relatedBooks: ["people_skills"],
          evidenceUrls: ["https://www.tiktok.com/@book_alpha/video/1"],
          firstDiscoveredAt: "2026-05-10T09:00:00.000Z",
          lastDiscoveredAt: "2026-05-10T10:00:00.000Z"
        },
        {
          id: "candidate-book_beta",
          handle: "book_beta",
          profileUrl: "https://www.tiktok.com/@book_beta",
          status: "candidate",
          sourceQuery: "street smart children",
          relatedBooks: ["raise_children_street_smart"],
          evidenceUrls: ["https://www.tiktok.com/@book_beta/video/2"],
          firstDiscoveredAt: "2026-05-10T09:05:00.000Z",
          lastDiscoveredAt: "2026-05-10T10:05:00.000Z"
        }
      ])
    );

    const result = await promoteAccountCandidates({ dataDir });

    assert.equal(result.promoted, 2);
    assert.equal(result.target.accounts, 2);
    const accounts = JSON.parse(await readFile(path.join(dataDir, "seeds", "accounts.json"), "utf8"));
    assert.deepEqual(accounts.map((account) => account.handle), ["book_alpha", "book_beta"]);
    assert.equal(accounts[0].enabled, true);
    assert.equal(accounts[0].sourceQuery, "people skill");
    assert.deepEqual(accounts[0].relatedBooks, ["people_skills"]);
    assert.deepEqual(accounts[1].evidenceUrls, ["https://www.tiktok.com/@book_beta/video/2"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
