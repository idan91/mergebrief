import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { buildReceipt } from "./receipt";

const t = createI18n().t;
import type { SessionSnapshot } from "../session";

const model = buildBriefViewModel(briefFixture);
const flagId = model.flags[0]!.id;
const secondFlag = model.flags[1]!;

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    briefId: "fixture-brief-1",
    dispositions: { [flagId]: { kind: "open" } },
    dominants: { g1: "bugfix" },
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    reviewComments: [],
    reviewOutcome: "comment",
    ...overrides,
  };
}

describe("buildReceipt", () => {
  it("reports progress and subject from the brief and snapshot", () => {
    const receipt = buildReceipt(
      t,
      snapshot({ reviewedChunkIds: ["chunk-a"] }),
      briefFixture,
      model,
    );
    expect(receipt.subject).toEqual({
      repo: "acme/widgets",
      number: 42,
      sha: "abcdef1234567890",
    });
    expect(receipt.progress).toEqual({
      reviewedChunks: 1,
      chunkTotal: 2,
      flagTotal: 2,
    });
  });

  it("counts dispositions and lists an open flag by default", () => {
    const receipt = buildReceipt(t, snapshot(), briefFixture, model);
    expect(receipt.counts).toEqual({ addressed: 0, dismissed: 0, open: 2 });
    expect(receipt.open).toEqual([
      { id: flagId, attr: "no-tests", file: "src/leak.ts" },
      {
        id: secondFlag.id,
        attr: "comment-contradicts-code",
        file: "src/leak.ts",
      },
    ]);
  });

  it("carries a dismissal reason verbatim", () => {
    const receipt = buildReceipt(
      t,
      snapshot({
        dispositions: {
          [flagId]: {
            kind: "dismissed",
            reason: "Covered by integration suite.",
          },
        },
      }),
      briefFixture,
      model,
    );
    expect(receipt.counts.dismissed).toBe(1);
    expect(receipt.dismissed).toEqual([
      {
        id: flagId,
        attr: "no-tests",
        file: "src/leak.ts",
        reason: "Covered by integration suite.",
      },
    ]);
  });

  it("resolves addressed evidence per flag", () => {
    const receipt = buildReceipt(
      t,
      snapshot({
        dispositions: {
          [flagId]: {
            kind: "addressed",
            evidence: { kind: "chunk-reviewed", chunkId: "chunk-a" },
          },
        },
      }),
      briefFixture,
      model,
    );
    expect(receipt.addressed).toEqual([
      {
        id: flagId,
        attr: "no-tests",
        file: "src/leak.ts",
        evidence: { kind: "chunk-reviewed", chunkId: "chunk-a" },
        evidenceLabel: "reviewed related chunk src/leak.ts",
      },
    ]);
  });

  it("keeps addressed-pending-evidence (no evidence key)", () => {
    const receipt = buildReceipt(
      t,
      snapshot({ dispositions: { [flagId]: { kind: "addressed" } } }),
      briefFixture,
      model,
    );
    expect(receipt.addressed).toEqual([
      { id: flagId, attr: "no-tests", file: "src/leak.ts" },
    ]);
  });

  it("counts reclassified groups and maps comments to first lines with status", () => {
    const anchor = {
      chunkId: "chunk-a",
      file: "src/leak.ts",
      side: "new" as const,
      startLine: 10,
      endLine: 12,
      rowIds: ["chunk-a:1"],
      selectedText: "validate(a);",
    };
    const receipt = buildReceipt(
      t,
      snapshot({
        reclassifiedGroupIds: ["g1"],
        reviewComments: [
          {
            id: "c1",
            anchor,
            body: "Please add a test.\nSecond line.",
            status: "draft",
            collapsed: false,
          },
          {
            // Posted by an earlier submit — the receipt must distinguish it
            // from the drafts the NEXT submit will ship.
            id: "c0",
            anchor,
            body: "Already posted.",
            status: "submitted",
            collapsed: false,
          },
        ],
      }),
      briefFixture,
      model,
    );
    expect(receipt.reclassifiedCount).toBe(1);
    expect(receipt.comments).toEqual([
      {
        id: "c1",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 12,
        firstLine: "Please add a test.",
        status: "draft",
      },
      {
        id: "c0",
        file: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 12,
        firstLine: "Already posted.",
        status: "submitted",
      },
    ]);
  });
});

describe("receipt repo-config record", () => {
  const SNAPSHOT = {
    files: [
      {
        path: ".mergebrief/instructions.md",
        blobSha: "i1i2i3i4",
        outcome: "applied" as const,
      },
      {
        path: ".mergebrief/settings.yaml",
        blobSha: null,
        outcome: "absent" as const,
      },
      {
        path: ".mergebrief/policy.yaml",
        blobSha: "p1p2p3p4p5",
        outcome: "applied" as const,
      },
    ],
    collisions: ["touches-auth"],
    policy: {
      firedCustomAttributes: [],
      deEmphasize: [
        { attribute: "widens-error-handling" },
        { attribute: "no-tests" },
      ],
    },
  };

  it("carries the per-file table, collisions, and the de-emphasis line", () => {
    const receipt = buildReceipt(t, snapshot(), briefFixture, model, SNAPSHOT);
    expect(receipt.repoConfig?.files.map((f) => f.outcome)).toEqual([
      "applied",
      "absent",
      "applied",
    ]);
    expect(receipt.repoConfig?.collisions).toEqual(["touches-auth"]);
    expect(receipt.repoConfig?.deEmphasisLine).toBe(
      "2 attributes de-emphasized by repo policy @ p1p2p3p",
    );
  });

  it("stays absent without a snapshot or with an all-absent surface", () => {
    expect(
      buildReceipt(t, snapshot(), briefFixture, model).repoConfig,
    ).toBeUndefined();
    const allAbsent = {
      files: SNAPSHOT.files.map((file) => ({
        ...file,
        blobSha: null,
        outcome: "absent" as const,
      })),
      collisions: [],
      policy: null,
    };
    expect(
      buildReceipt(t, snapshot(), briefFixture, model, allAbsent).repoConfig,
    ).toBeUndefined();
  });
});

describe("receipt de-emphasis count dedupes path-scoped rules", () => {
  it("two rules on one attribute count as one attribute", () => {
    const receipt = buildReceipt(t, snapshot(), briefFixture, model, {
      files: [
        {
          path: ".mergebrief/instructions.md",
          blobSha: null,
          outcome: "absent" as const,
        },
        {
          path: ".mergebrief/settings.yaml",
          blobSha: null,
          outcome: "absent" as const,
        },
        {
          path: ".mergebrief/policy.yaml",
          blobSha: "p1p2p3p4",
          outcome: "applied" as const,
        },
      ],
      collisions: [],
      policy: {
        firedCustomAttributes: [],
        deEmphasize: [
          { attribute: "no-tests", paths: ["src/**"] },
          { attribute: "no-tests", paths: ["docs/**"] },
        ],
      },
    });
    expect(receipt.repoConfig?.deEmphasisLine).toBe(
      "1 attribute de-emphasized by repo policy @ p1p2p3p",
    );
  });
});
