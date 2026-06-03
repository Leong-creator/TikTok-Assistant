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
  readCollectionCursor,
  rebuildWhitelistVideoTargetsAfterAccountCoverage,
  readCollectionPlan
} from "../src/monitor/collection-plan.mjs";

const VID_A = "7623225588626590990";
const VID_B = "7629734921489206542";
const VID_C = "7637484035350088974";
const VID_D = "7637005665608682765";
const VID_E = "7632538097196027150";
const VID_F = "7639912345678901234";

test("buildCollectionPlan prioritizes uncovered evidence video targets before refresh targets", () => {
  const plan = buildCollectionPlan({
    now: new Date("2026-05-12T05:00:00.000Z"),
    accounts: [
      {
        id: "account-covered-evidence",
        handle: "covered_evidence",
        profileUrl: "https://www.tiktok.com/@covered_evidence",
        enabled: true,
        evidenceUrls: [`https://www.tiktok.com/@covered_evidence/video/${VID_A}`]
      },
      {
        id: "account-uncovered-evidence",
        handle: "uncovered_evidence",
        profileUrl: "https://www.tiktok.com/@uncovered_evidence",
        enabled: true,
        evidenceUrls: [`https://www.tiktok.com/@uncovered_evidence/video/${VID_B}`]
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
    ["uncovered_profile", "covered_profile", "uncovered_evidence", "covered_evidence"]
  );
});

test("buildCollectionPlan falls back to candidate evidence and latest snapshot video urls before profile targets", () => {
  const plan = buildCollectionPlan({
    now: new Date("2026-05-15T00:00:00.000Z"),
    accounts: [
      {
        id: "account-from-candidate",
        handle: "from_candidate",
        profileUrl: "https://www.tiktok.com/@from_candidate",
        enabled: true,
        evidenceUrls: []
      },
      {
        id: "account-from-snapshot",
        handle: "from_snapshot",
        profileUrl: "https://www.tiktok.com/@from_snapshot",
        enabled: true,
        evidenceUrls: []
      },
      {
        id: "account-profile-only",
        handle: "profile_only",
        profileUrl: "https://www.tiktok.com/@profile_only",
        enabled: true,
        evidenceUrls: []
      }
    ],
    candidates: [
      {
        handle: "from_candidate",
        evidenceUrls: [`https://www.tiktok.com/@from_candidate/video/${VID_A}`]
      }
    ],
    snapshots: [
      {
        accountHandle: "from_snapshot",
        collectedAt: "2026-05-14T23:00:00.000Z",
        videoUrl: `https://www.tiktok.com/@from_snapshot/video/${VID_B}`
      }
    ]
  });

  assert.deepEqual(
    plan.videoTargets.map((item) => ({ handle: item.accountHandle, videoUrl: item.videoUrl })),
    [
      { handle: "from_candidate", videoUrl: `https://www.tiktok.com/@from_candidate/video/${VID_A}` },
      { handle: "from_snapshot", videoUrl: `https://www.tiktok.com/@from_snapshot/video/${VID_B}` }
    ]
  );
  assert.deepEqual(plan.accountTargets.map((item) => item.handle), ["profile_only", "from_candidate", "from_snapshot"]);
});

test("buildCollectionPlan includes all recent snapshot videos for tracked accounts", () => {
  const plan = buildCollectionPlan({
    now: new Date("2026-05-21T00:00:00.000Z"),
    accounts: [
      {
        id: "account-alpha",
        handle: "alpha",
        profileUrl: "https://www.tiktok.com/@alpha",
        enabled: true,
        evidenceUrls: []
      }
    ],
    snapshots: [
      {
        accountHandle: "alpha",
        collectedAt: "2026-05-20T00:00:00.000Z",
        postedAt: "2026-05-20T00:00:00.000Z",
        videoUrl: `https://www.tiktok.com/@alpha/video/${VID_C}`
      },
      {
        accountHandle: "alpha",
        collectedAt: "2026-05-19T00:00:00.000Z",
        postedAt: "2026-05-19T00:00:00.000Z",
        videoUrl: `https://www.tiktok.com/@alpha/video/${VID_D}`
      },
      {
        accountHandle: "alpha",
        collectedAt: "2026-01-01T00:00:00.000Z",
        postedAt: "2026-01-01T00:00:00.000Z",
        videoUrl: "https://www.tiktok.com/@alpha/video/old"
      }
    ]
  });

  assert.deepEqual(
    plan.videoTargets.map((item) => item.videoUrl),
    [
      `https://www.tiktok.com/@alpha/video/${VID_C}`,
      `https://www.tiktok.com/@alpha/video/${VID_D}`
    ]
  );
});

test("buildCollectionPlan ignores malformed discovered video urls", () => {
  const plan = buildCollectionPlan({
    now: new Date("2026-05-21T00:00:00.000Z"),
    accounts: [
      {
        id: "account-alpha",
        handle: "alpha",
        profileUrl: "https://www.tiktok.com/@alpha",
        enabled: true,
        evidenceUrls: [
          `https://www.tiktok.com/@alpha/video/${VID_E}`,
          "https://www.tiktok.com/@alpha/video/1622962893630470",
          "https://www.tiktok.com/@alpha/video/322505"
        ]
      }
    ],
    snapshots: [
      {
        accountHandle: "alpha",
        collectedAt: "2026-05-20T00:00:00.000Z",
        postedAt: "2026-05-20T00:00:00.000Z",
        videoUrl: `https://www.tiktok.com/@alpha/video/${VID_E}`
      },
      {
        accountHandle: "alpha",
        collectedAt: "2026-05-20T00:00:00.000Z",
        postedAt: "2026-05-20T00:00:00.000Z",
        videoUrl: "https://www.tiktok.com/@alpha/video/1622962893630470"
      }
    ]
  });

  assert.deepEqual(plan.videoTargets.map((item) => item.videoUrl), [
    `https://www.tiktok.com/@alpha/video/${VID_E}`
  ]);
});

test("buildCollectionPlan uses whitelist rows as the active plan source, skips 橱窗已掉, and does not dedupe duplicate handles", () => {
  const recentPostedAt = "2026-05-20T00:00:00.000Z";
  const oldPostedAt = "2026-01-01T00:00:00.000Z";
  const plan = buildCollectionPlan({
    now: new Date("2026-05-21T00:00:00.000Z"),
    accounts: [
      {
        id: "wl-alpha",
        handle: "alpha",
        profileUrl: "https://www.tiktok.com/@alpha",
        sourceTables: ["People Skills"],
        materialTypes: ["AI动画"],
        skipTracking: false
      },
      {
        id: "wl-shared",
        handle: "shared",
        profileUrl: "https://www.tiktok.com/@shared",
        sourceTables: ["People Skills", "Raise Children"],
        materialTypes: ["AI动画", "画线"],
        skipTracking: false
      },
      {
        id: "wl-shared-2",
        handle: "shared",
        profileUrl: "https://www.tiktok.com/@shared?is_from_webapp=1&sender_device=pc",
        sourceTables: ["Raise Children"],
        materialTypes: ["画线"],
        skipTracking: false
      },
      {
        id: "wl-skip",
        handle: "skip_me",
        profileUrl: "https://www.tiktok.com/@skip_me",
        sourceTables: ["Raise Children"],
        materialTypes: ["AI动画"],
        skipTracking: true
      }
    ],
    snapshots: [
      {
        accountHandle: "alpha",
        collectedAt: "2026-05-20T12:00:00.000Z",
        postedAt: recentPostedAt,
        videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`
      },
      {
        accountHandle: "shared",
        collectedAt: "2026-05-20T13:00:00.000Z",
        postedAt: recentPostedAt,
        videoUrl: `https://www.tiktok.com/@shared/video/${VID_B}`
      },
      {
        accountHandle: "shared",
        collectedAt: "2026-05-20T13:00:00.000Z",
        postedAt: oldPostedAt,
        videoUrl: `https://www.tiktok.com/@shared/video/${VID_C}`
      },
      {
        accountHandle: "skip_me",
        collectedAt: "2026-05-20T14:00:00.000Z",
        postedAt: recentPostedAt,
        videoUrl: `https://www.tiktok.com/@skip_me/video/${VID_D}`
      }
    ]
  });

  assert.equal(plan.counts.accounts, 3);
  assert.equal(plan.counts.videoTargets, 2);
  assert.deepEqual(plan.accountTargets.map((item) => item.id), ["wl-alpha", "wl-shared", "wl-shared-2"]);
  assert.deepEqual(
    plan.videoTargets.map((item) => ({ handle: item.accountHandle, videoUrl: item.videoUrl })),
    [
      { handle: "alpha", videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}` },
      { handle: "shared", videoUrl: `https://www.tiktok.com/@shared/video/${VID_B}` }
    ]
  );
  assert.deepEqual(plan.accountTargets[1].sourceTables, ["People Skills", "Raise Children"]);
  assert.deepEqual(plan.accountTargets[2].sourceTables, ["Raise Children"]);
  assert.deepEqual(
    plan.accountTargets[0].knownVideos.map((item) => item.videoUrl),
    [`https://www.tiktok.com/@alpha/video/${VID_A}`]
  );
  assert.deepEqual(
    plan.accountTargets[1].knownVideos.map((item) => item.videoUrl),
    [`https://www.tiktok.com/@shared/video/${VID_B}`]
  );
});

test("whitelist collection plan still advances through account batches before known-video refresh batches", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-whitelist-batches-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "state"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        {
          collectedAt: "2026-05-20T13:00:00.000Z",
          postedAt: "2026-05-20T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`
        },
        {
          collectedAt: "2026-05-20T14:00:00.000Z",
          postedAt: "2026-05-19T00:00:00.000Z",
          accountHandle: "beta",
          videoUrl: `https://www.tiktok.com/@beta/video/${VID_B}`
        }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );

    await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-21T00:00:00.000Z"),
      whitelistAccounts: [
        {
          id: "wl-alpha",
          handle: "alpha",
          profileUrl: "https://www.tiktok.com/@alpha",
          sourceTables: ["People Skills"],
          materialTypes: ["AI动画"],
          skipTracking: false
        },
        {
          id: "wl-beta",
          handle: "beta",
          profileUrl: "https://www.tiktok.com/@beta",
          sourceTables: ["Raise Children"],
          materialTypes: ["画线"],
          skipTracking: false
        }
      ]
    });

    const firstBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(firstBatch.batch.accounts.length, 1);
    assert.equal(firstBatch.batch.videos.length, 0);

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const secondBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(secondBatch.batch.accounts.length, 1);
    assert.equal(secondBatch.batch.videos.length, 0);

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const thirdBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(thirdBatch.batch.accounts.length, 0);
    assert.equal(thirdBatch.batch.videos.length, 1);
    assert.equal(thirdBatch.batch.videos[0].accountHandle, "alpha");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rebuildWhitelistVideoTargetsAfterAccountCoverage keeps only videos not refreshed during the current account pass", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-whitelist-rebuild-"));
  try {
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await mkdir(path.join(dataDir, "state"), { recursive: true });
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        {
          collectedAt: "2026-05-20T13:00:00.000Z",
          postedAt: "2026-05-20T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`
        },
        {
          collectedAt: "2026-05-20T14:00:00.000Z",
          postedAt: "2026-05-19T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_B}`
        }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );

    const plan = await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-21T00:00:00.000Z"),
      whitelistAccounts: [
        {
          id: "wl-alpha",
          handle: "alpha",
          profileUrl: "https://www.tiktok.com/@alpha",
          sourceTables: ["People Skills"],
          materialTypes: ["AI动画"],
          skipTracking: false
        }
      ]
    });

    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      [
        {
          collectedAt: "2026-05-20T13:00:00.000Z",
          postedAt: "2026-05-20T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`
        },
        {
          collectedAt: "2026-05-20T14:00:00.000Z",
          postedAt: "2026-05-19T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_B}`
        },
        {
          collectedAt: "2026-05-21T00:05:00.000Z",
          postedAt: "2026-05-20T00:00:00.000Z",
          accountHandle: "alpha",
          videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`,
          views: 9000
        }
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"
    );

    const rebuilt = await rebuildWhitelistVideoTargetsAfterAccountCoverage({
      dataDir,
      now: new Date("2026-05-21T00:05:00.000Z"),
      cycleStartedAt: plan.createdAt
    });

    assert.equal(rebuilt.counts.videoTargets, 1);
    assert.deepEqual(rebuilt.videoTargets.map((item) => item.videoUrl), [
      `https://www.tiktok.com/@alpha/video/${VID_B}`
    ]);

    const persistedPlan = await readCollectionPlan(dataDir);
    assert.equal(persistedPlan.counts.videoTargets, 1);
    assert.deepEqual(persistedPlan.videoTargets.map((item) => item.videoUrl), [
      `https://www.tiktok.com/@alpha/video/${VID_B}`
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collection plan cursor advances through profile batches before video batches", async () => {
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
          evidenceUrls: [`https://www.tiktok.com/@alpha/video/${VID_A}`]
        },
        {
          id: "account-beta",
          handle: "beta",
          profileUrl: "https://www.tiktok.com/@beta",
          enabled: true,
          evidenceUrls: [`https://www.tiktok.com/@beta/video/${VID_B}`]
        },
        {
          id: "account-gamma",
          handle: "gamma",
          profileUrl: "https://www.tiktok.com/@gamma",
          enabled: true
        }
      ])
    );
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify(
        [
          {
            id: "candidate-delta",
            handle: "delta",
            profileUrl: "https://www.tiktok.com/@delta",
            evidenceUrls: [`https://www.tiktok.com/@delta/video/${VID_F}`]
          }
        ],
        null,
        2
      )
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
    assert.equal(firstBatch.batch.videos.length, 0);
    assert.equal(firstBatch.batch.accounts.length, 1);
    assert.equal(firstBatch.batch.accounts[0].handle, "gamma");

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const secondBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(secondBatch.batch.accounts[0].handle, "alpha");

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const thirdBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(thirdBatch.batch.accounts[0].handle, "beta");

    await advanceCollectionCursor({ dataDir, consumedAccounts: 1 });
    const fourthBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(fourthBatch.batch.accounts.length, 0);
    assert.equal(fourthBatch.batch.videos[0].accountHandle, "alpha");

    await advanceCollectionCursor({ dataDir, consumedVideos: 1 });
    const finalCursor = await readCollectionCursor(dataDir);
    assert.equal(finalCursor.completed, false);

    const fifthBatch = await getCollectionBatch({
      dataDir,
      maxVideoTargets: 1,
      maxAccountTargets: 1
    });
    assert.equal(fifthBatch.batch.videos[0].accountHandle, "beta");

    await advanceCollectionCursor({ dataDir, consumedVideos: 1 });
    const completedCursor = await readCollectionCursor(dataDir);
    assert.equal(completedCursor.completed, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("createCollectionPlan promotes accounts with snapshot or candidate evidence into video targets", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-fallback-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify(
        [
          {
            id: "account-alpha",
            handle: "alpha",
            profileUrl: "https://www.tiktok.com/@alpha",
            enabled: true,
            evidenceUrls: []
          },
          {
            id: "account-beta",
            handle: "beta",
            profileUrl: "https://www.tiktok.com/@beta",
            enabled: true,
            evidenceUrls: []
          }
        ],
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "seeds", "account_candidates.json"),
      JSON.stringify(
        [
          {
            id: "candidate-alpha",
            handle: "alpha",
            profileUrl: "https://www.tiktok.com/@alpha",
            evidenceUrls: [`https://www.tiktok.com/@alpha/video/${VID_A}`]
          }
        ],
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      `${JSON.stringify({
        collectedAt: "2026-05-14T20:00:00.000Z",
        accountHandle: "beta",
        videoUrl: `https://www.tiktok.com/@beta/video/${VID_B}`
      })}\n`
    );

    const plan = await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    assert.deepEqual(
      plan.videoTargets.map((item) => ({ handle: item.accountHandle, videoUrl: item.videoUrl })),
      [
        { handle: "alpha", videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}` },
        { handle: "beta", videoUrl: `https://www.tiktok.com/@beta/video/${VID_B}` }
      ]
    );
    assert.deepEqual(plan.accountTargets.map((item) => item.handle), ["alpha", "beta"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("createCollectionPlan does not fall back to legacy seeds when whitelist mode is configured but whitelist rows are unavailable", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-whitelist-strict-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify(
        [
          {
            id: "legacy-alpha",
            handle: "legacy_alpha",
            profileUrl: "https://www.tiktok.com/@legacy_alpha",
            enabled: true
          }
        ],
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "base_dashboard_whitelist_config.json"),
      JSON.stringify(
        {
          baseToken: "app_test",
          tableNames: {
            accounts: "白名单追踪账号池",
            videos: "白名单追踪视频池",
            themes: "白名单主题参考库"
          }
        },
        null,
        2
      )
    );

    const plan = await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    assert.equal(plan.counts.accounts, 0);
    assert.equal(plan.accountTargets.length, 0);
    assert.equal(plan.videoTargets.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("createCollectionPlan carries the latest known video metrics on recent video targets for fallback refreshers", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tk-monitor-plan-video-metrics-"));
  try {
    await mkdir(path.join(dataDir, "seeds"), { recursive: true });
    await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
    await writeFile(
      path.join(dataDir, "seeds", "accounts.json"),
      JSON.stringify(
        [
          {
            id: "account-alpha",
            handle: "alpha",
            profileUrl: "https://www.tiktok.com/@alpha",
            enabled: true
          }
        ],
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, "snapshots", "video_snapshots.jsonl"),
      `${JSON.stringify({
        collectedAt: "2026-05-14T20:00:00.000Z",
        postedAt: "2026-05-14T10:00:00.000Z",
        accountHandle: "alpha",
        videoUrl: `https://www.tiktok.com/@alpha/video/${VID_A}`,
        views: 4321,
        likes: 98,
        comments: 7,
        shares: 6,
        caption: "Known alpha video",
        productRefs: []
      })}\n`
    );

    const plan = await createCollectionPlan({
      dataDir,
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    assert.equal(plan.videoTargets.length, 1);
    assert.equal(plan.videoTargets[0].views, 4321);
    assert.equal(plan.videoTargets[0].likes, 98);
    assert.equal(plan.videoTargets[0].comments, 7);
    assert.equal(plan.videoTargets[0].shares, 6);
    assert.equal(plan.videoTargets[0].caption, "Known alpha video");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
