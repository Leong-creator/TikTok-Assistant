import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWhitelistAccounts } from "../src/monitor/whitelist-accounts.mjs";

test("loadWhitelistAccounts reads the five Base input tables without deduping rows and still marks 橱窗已掉 accounts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-whitelist-accounts-"));
  try {
    await writeFile(
      path.join(dataDir, "base_dashboard_config.json"),
      JSON.stringify({ baseToken: "app_test" })
    );

    const result = await loadWhitelistAccounts({
      dataDir,
      platform: "linux",
      larkCliPath: "lark-cli",
      async execFileImpl(command, args) {
        if (args[1] === "+table-list") {
          return {
            stdout: JSON.stringify({
              data: {
                tables: [
                  { id: "tbl_people", name: "People Skills" },
                  { id: "tbl_raise", name: "Raise Children" },
                  { id: "tbl_other", name: "其他品" }
                ]
              }
            })
          };
        }
        if (args[1] === "+record-list" && args.includes("tbl_people")) {
          assert.ok(args.includes("--format"));
          assert.ok(args.includes("json"));
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["账号名", "主页链接", "素材类型", "备注"],
                data: [
                  ["alpha_books", "https://www.tiktok.com/@alpha_books", "AI动画", ""],
                  ["duplicate_handle", "https://www.tiktok.com/@shared_handle", "画线", ""]
                ],
                record_id_list: ["rec_a", "rec_b"]
              }
            })
          };
        }
        if (args[1] === "+record-list" && args.includes("tbl_raise")) {
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["账号名", "主页链接", "素材类型", "备注"],
                data: [
                  ["shared_handle", "https://www.tiktok.com/@shared_handle", "AI动画", ""],
                  ["skip_me", "https://www.tiktok.com/@skip_me", "AI动画", "橱窗已掉，先不追踪"]
                ],
                record_id_list: ["rec_c", "rec_d"]
              }
            })
          };
        }
        if (args[1] === "+record-list" && args.includes("tbl_other")) {
          return {
            stdout: JSON.stringify({
              data: {
                fields: ["账号名", "主页链接", "素材类型", "备注"],
                data: [],
                record_id_list: []
              }
            })
          };
        }
        throw new Error(`unexpected args: ${args.join(" ")}`);
      }
    });

    assert.equal(result.length, 4);
    const sharedRows = result.filter((item) => item.handle === "shared_handle");
    assert.equal(sharedRows.length, 2);
    assert.deepEqual(sharedRows.map((item) => item.sourceTable), ["People Skills", "Raise Children"]);
    assert.deepEqual(sharedRows.map((item) => item.materialType), ["画线", "AI动画"]);
    assert.notEqual(sharedRows[0].id, sharedRows[1].id);
    assert.ok(sharedRows.every((item) => item.skipTracking === false));

    const skipped = result.find((item) => item.handle === "skip_me");
    assert.ok(skipped);
    assert.equal(skipped.skipTracking, true);
    assert.equal(skipped.enabled, true);
    assert.match(skipped.remark, /橱窗已掉/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
