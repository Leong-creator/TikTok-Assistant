import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDreaminaText2ImageArgs,
  nextDreaminaConcurrency,
  runDreaminaQueue
} from "../src/dreamina-provider.mjs";

test("Dreamina text2image args include session and generation settings", () => {
  const args = buildDreaminaText2ImageArgs({
    prompt: "竖版单张电影插画剧照，明亮客厅，中景，人物表情清楚",
    dreamina: {
      ratio: "9:16",
      resolutionType: "2k",
      pollSeconds: 90,
      modelVersion: "4.0",
      sessionId: 12345
    }
  });

  assert.deepEqual(args, [
    "text2image",
    "--prompt=竖版单张电影插画剧照，明亮客厅，中景，人物表情清楚",
    "--ratio=9:16",
    "--resolution_type=2k",
    "--poll=90",
    "--model_version=4.0",
    "--session=12345"
  ]);
});

test("Dreamina queue keeps failures isolated and respects max concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await runDreaminaQueue({
    items: ["S001", "S002", "S003", "S004"],
    concurrency: 2,
    worker: async (shotId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, shotId === "S001" ? 20 : 5));
      active -= 1;
      if (shotId === "S002") {
        throw new Error("simulated provider failure");
      }
      return `${shotId}-ok`;
    }
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled", "fulfilled"]
  );
  assert.equal(results[1].item, "S002");
  assert.match(results[1].reason, /simulated provider failure/);
});

test("Dreamina concurrency falls back to one for timeout or rate-limit style errors", () => {
  assert.equal(nextDreaminaConcurrency({ current: 2, error: new Error("request timeout") }), 1);
  assert.equal(nextDreaminaConcurrency({ current: 2, error: new Error("429 too many requests") }), 1);
  assert.equal(nextDreaminaConcurrency({ current: 2, error: new Error("ordinary prompt rejection") }), 2);
});
