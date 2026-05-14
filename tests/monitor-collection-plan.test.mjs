import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  advanceCollectionCursor,
  buildCollectionPlan,
  createCollectionPlan,
  getCollectionBatch,
  readCollectionCursor
} from "../src/monitor/collection-plan.mjs";

test("buildCollectionPlan prioritizes uncovered evidence video targets before refresh targets", () => {
  const plan = buildCollectionPlan({
    now: new Date("2026-05-12T05:00:00.000Z"),
    accounts: [
      {
        id: "account-covered-evidence",
        handle: "covered_evidence",
        profileUrl: "https://www.tiktok.com/@covered_evidence",
        enabled: true,
        evidenceUrls: ["https://www.tiktok.com/@covered_evidence/video/1"]
      },
      {
        id: "account-uncovered-evidence",
        handle: "uncovered_evidence",
        profileUrl: "https://www.tiktok.com/@uncovered_evidence",
        enabled: true,
        evidenceUrls: ["https://www.tiktok.com/@uncovered_evidence/video/1"]
      },
      {
        id: "account-covered-profile",
        handle: "covered_profile",
        profileUrl: "https://www.tiktok.com/@covered_profile",
        enabled: true,
        evidenceUrls: []
      },
      {
        id: "account-uncovered-profile",
        handle: "uncovered_profile",
        profileUrl: "https://www.tiktok.com/@uncovered_profile",
        enabled: true,
        evidenceUrls: []
      }
    ],
    snapshots: [
      {
        accountHandle: "covered_evidence",
        collectedAt: "2026-05-12T04:00:00.000Z"
      },
      {
        accountHandle: "covered_profile",
        collectedAt: "2026-05-12T04:30:00.000Z"
      }
    ]
  });

  assert.deepEqual(
    plan.videoTargets.map((item) => item.accountHandle),
    ["uncovered_evidence", "covered_evidence"]
  );
  assert.deepEqual(
    plan.accountTargets.map((item) => item.handle),
    ["uncovered_profile", "covered_profile"]
  );
});

test("collection plan cursor advances through video batches before profile batches", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify([
        {
          id: "account-alpha",
          handle: "alpha",
          profileUrl: "https://www.tiktok.com/@alpha",
          enabled: true,
          evidenceUrls: ["https://www.tiktok.com/@alpha/video/1"]
        },
        {
          id: "account-beta",
          handle: "beta",
          profileUrl: "https://www.tiktok.com/@beta",
          enabled: true,
          evidenceUrls: ["https://www.tiktok.com/@beta/video/1"]
        },
        {
          id: "account-gamma",
          handle: "gamma",
          profileUrl: "https://www.tiktok.com/@gamma",
          enabled: true
        }
      ])
    );

    await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-12T05:00:00.000Z")
    });

    const firstBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(firstBatch.batch.videos.length, 1);
    assert.equal(firstBatch.batch.accounts.length, 0);
    assert.equal(firstBatch.batch.videos[0].accountHandle, "alpha");

    await advanceCollectionCursor({ dataDir, consumedVideos: 1 });
    const secondBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(secondBatch.batch.videos[0].accountHandle, "beta");

    await advanceCollectionCursor({ dataDir, consumedVideos: 1 });
    const thirdBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(thirdBatch.batch.videos.length, 0);
    assert.equal(thirdBatch.batch.accounts[0].handle, "gamma");

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const finalCursor = await readCollectionCursor(dataDir);
    assert.equal(finalCursor.completed, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
