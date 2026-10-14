// Boundary-guard tests for the read-API PR shapes. The API is trusted
// infrastructure but still an external boundary to this bundle, so responses
// are parsed, never cast.
import {
  WaitReasons,
  type ForkPrStackView,
  type GenerationSummaryView,
  type LastReviewComparisonView,
  type LinearPrStackView,
  type PreviousBriefComparisonView,
  type PrStackMemberView,
  type PullMetaView,
  type PullStackView,
  type RevisionComparisons,
  type RevisionView,
} from "contract";
import { describe, expect, it } from "vitest";
import type { DraftPolicy, Equals } from "types";
import type { z } from "zod/v4";

import { UnknownValues } from "@web/utils/open-enum/types";
import type { ReadsWireFields } from "@web/test/wire-fields";
import { parseWithSchema } from "@web/utils/parse-with-schema";
import {
  type availableLastReviewSchema,
  type draftPolicySummarySchema,
  type forkPrStackSchema,
  type generationSummarySchema,
  type lastReviewComparisonSchema,
  type linearPrStackSchema,
  type prComparisonsSchema,
  type previousBriefComparisonSchema,
  type prStackMemberSchema,
  prSummarySchema,
  pullStackSchema,
  type revisionSummarySchema,
  type unavailableLastReviewSchema,
} from "./schemas";
import type {
  ForkPrStack,
  LinearPrStack,
  PrStackMember,
  PullStack,
} from "@web/features/brief/model";
import type {
  AvailableLastReviewComparison,
  DraftPolicySummary,
  GenerationSummary,
  LastReviewComparison,
  PrComparisons,
  PreviousBriefComparison,
  PrSummary,
  RevisionSummary,
  UnavailableLastReviewComparison,
} from "./types";

const ROW = {
  repoId: "424242",
  repoSlug: "octo/hello",
  prNumber: 7,
  title: "feat: widgets",
  state: "open",
  baseSha: "base-1",
  headSha: "head-1",
  briefAvailable: true,
  generation: {
    status: "succeeded",
    phase: null,
    attempts: 0,
    errorCode: null,
    errorParams: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
  },
  updatedAt: "2026-07-06T12:00:00.000Z",
  draft: false,
  viewerIsAuthor: false,
};

const PENDING_GENERATION = {
  status: "pending",
  phase: null,
  attempts: 0,
  errorCode: null,
  errorParams: null,
  updatedAt: "2026-07-06T12:00:00.000Z",
};

describe("prSummarySchema behind", () => {
  it("reads behind when present and treats an older server as caught up", () => {
    const behind = parseWithSchema(prSummarySchema, { ...ROW, behind: true });
    const absent = parseWithSchema(prSummarySchema, ROW);
    const wrong = parseWithSchema(prSummarySchema, { ...ROW, behind: "yes" });

    expect(behind.ok && behind.value.behind).toBe(true);
    expect(absent.ok && absent.value.behind).toBe(false);
    expect(wrong.ok).toBe(false);
  });
});

describe("prSummarySchema", () => {
  it("reads the wire's null PR and generation fields as absent", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      repoSlug: null,
      title: null,
      baseSha: null,
      headSha: null,
    });
    const noGeneration = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: null,
    });

    if (!parsed.ok || !noGeneration.ok) {
      throw new Error("unreachable");
    }
    for (const field of ["repoSlug", "title", "baseSha", "headSha"]) {
      expect(parsed.value).not.toHaveProperty(field);
    }
    expect(parsed.value.generation).toStrictEqual({
      status: "succeeded",
      attempts: 0,
      updatedAt: "2026-07-06T12:00:00.000Z",
    });
    expect(noGeneration.value).not.toHaveProperty("generation");
  });

  it("parses the failure code and sanitized detail off the wire", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        status: "failed",
        phase: null,
        attempts: 1,
        errorCode: "provider-rate-limit",
        errorParams: { detail: "429 from the provider" },
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation?.errorCode).toBe("provider-rate-limit");
    expect(parsed.value.generation?.errorDetail).toBe("429 from the provider");
  });

  it("degrades a code this bundle does not know, keeping the detail", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        status: "failed",
        phase: null,
        attempts: 1,
        errorCode: "spend-capped",
        errorParams: { detail: "cap reached" },
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    });
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation).not.toHaveProperty("errorCode");
    expect(parsed.value.generation?.errorDetail).toBe("cap reached");
  });

  it("ignores a top-level errorDetail the wire never sends", () => {
    for (const errorDetail of ["forged", 5]) {
      const parsed = parseWithSchema(prSummarySchema, {
        ...ROW,
        generation: { ...PENDING_GENERATION, errorDetail },
      });

      if (!parsed.ok) {
        throw new Error("unreachable");
      }
      expect(parsed.value.generation).not.toHaveProperty("errorDetail");
    }
  });

  it("ignores a non-object errorParams and a non-string detail", () => {
    const base = {
      status: "failed",
      phase: null,
      attempts: 1,
      errorCode: "unknown",
      updatedAt: "2026-07-06T12:00:00.000Z",
    };
    const notObject = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...base, errorParams: "nope" },
    });
    if (!notObject.ok) {
      throw new Error("unreachable");
    }
    expect(notObject.value.generation).not.toHaveProperty("errorDetail");
    const loose = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...base, errorParams: { detail: 5 } },
    });
    if (!loose.ok) {
      throw new Error("unreachable");
    }
    expect(loose.value.generation).not.toHaveProperty("errorDetail");
  });

  it("parses a known wait reason off a pending generation", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...PENDING_GENERATION, waitReason: "waiting-for-slot" },
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation?.waitReason).toBe(
      WaitReasons.WAITING_FOR_SLOT,
    );
  });

  it("leaves the wait reason absent when the wire carries none", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: PENDING_GENERATION,
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation).not.toHaveProperty("waitReason");
  });

  it("degrades a wait reason this bundle does not know to absent", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...PENDING_GENERATION, waitReason: "rate-limited" },
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation).not.toHaveProperty("waitReason");
  });

  it("accepts a full row", () => {
    const parsed = parseWithSchema(prSummarySchema, ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.prNumber).toBe(7);
    expect(parsed.value.generation?.status).toBe("succeeded");
  });

  it("parses draft + viewerIsAuthor and requires both", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draft: true,
      viewerIsAuthor: true,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draft).toBe(true);
    expect(parsed.value.viewerIsAuthor).toBe(true);

    const { draft: _noDraft, ...withoutDraft } = ROW;
    expect(parseWithSchema(prSummarySchema, withoutDraft).ok).toBe(false);
    const { viewerIsAuthor: _noViewer, ...withoutViewer } = ROW;
    expect(parseWithSchema(prSummarySchema, withoutViewer).ok).toBe(false);
    // A non-boolean must be rejected, not coerced, this gates affordances.
    expect(
      parseWithSchema(prSummarySchema, { ...ROW, viewerIsAuthor: "true" }).ok,
    ).toBe(false);
  });

  it("parses appInstalled and reads false when a server omits it", () => {
    const installed = parseWithSchema(prSummarySchema, {
      ...ROW,
      appInstalled: true,
    });
    if (!installed.ok) {
      throw new Error(installed.error);
    }
    expect(installed.value.appInstalled).toBe(true);

    const legacy = parseWithSchema(prSummarySchema, ROW);
    if (!legacy.ok) {
      throw new Error(legacy.error);
    }
    expect(legacy.value.appInstalled).toBe(false);

    expect(
      parseWithSchema(prSummarySchema, { ...ROW, appInstalled: "yes" }).ok,
    ).toBe(false);
  });

  it("parses viewerCanResolve and FAILS CLOSED when it is absent", () => {
    const capable = parseWithSchema(prSummarySchema, {
      ...ROW,
      viewerCanResolve: true,
    });
    expect(capable.ok).toBe(true);
    if (!capable.ok) {
      throw new Error("unreachable");
    }
    expect(capable.value.viewerCanResolve).toBe(true);

    const denied = parseWithSchema(prSummarySchema, {
      ...ROW,
      viewerCanResolve: false,
    });
    if (!denied.ok) {
      throw new Error("unreachable");
    }
    expect(denied.value.viewerCanResolve).toBe(false);

    // Absent = a server predating the field: no capability, so no affordance.
    // Unlike draft/viewerIsAuthor this is NOT a contract violation, the row
    // parses, it just carries no permission.
    const older = parseWithSchema(prSummarySchema, ROW);
    if (!older.ok) {
      throw new Error("unreachable");
    }
    expect(older.value.viewerCanResolve).toBe(false);

    // Present but not a boolean IS malformed, coercing a truthy string into a
    // capability would hand out affordances the server never granted.
    expect(
      parseWithSchema(prSummarySchema, { ...ROW, viewerCanResolve: "true" }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(prSummarySchema, { ...ROW, viewerCanResolve: null }).ok,
    ).toBe(false);
  });

  it("parses authorLogin and reads a null or absent one as absent", () => {
    const authored = parseWithSchema(prSummarySchema, {
      ...ROW,
      authorLogin: "mira-k",
    });
    if (!authored.ok) {
      throw new Error("unreachable");
    }
    expect(authored.value.authorLogin).toBe("mira-k");

    const unknown = parseWithSchema(prSummarySchema, {
      ...ROW,
      authorLogin: null,
    });
    if (!unknown.ok) {
      throw new Error("unreachable");
    }
    expect(unknown.value).not.toHaveProperty("authorLogin");
    expect(parseWithSchema(prSummarySchema, ROW).ok).toBe(true);

    expect(
      parseWithSchema(prSummarySchema, { ...ROW, authorLogin: 7 }).ok,
    ).toBe(false);
  });

  it("accepts nullable fields on a waiting row with no brief and no title", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      title: null,
      baseSha: null,
      headSha: null,
      briefAvailable: false,
      generation: null,
    });
    expect(parsed.ok).toBe(true);
  });

  it("reads a generation status this bundle predates as unknown", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...ROW.generation, status: "exploded" },
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.generation?.status).toBe(UnknownValues.UNKNOWN);
  });

  it("rejects a missing required field", () => {
    const { prNumber: _dropped, ...rest } = ROW;
    expect(parseWithSchema(prSummarySchema, rest).ok).toBe(false);
  });

  it("reads a state this bundle predates as unknown and still requires one", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      state: "reopened",
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.state).toBe(UnknownValues.UNKNOWN);
    const { state: _absent, ...stateless } = ROW;
    expect(parseWithSchema(prSummarySchema, stateless).ok).toBe(false);
  });

  it("rejects a non-numeric repoId, which is interpolated into route URLs", () => {
    expect(
      parseWithSchema(prSummarySchema, { ...ROW, repoId: "123/extra" }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(prSummarySchema, { ...ROW, repoId: "?x=1" }).ok,
    ).toBe(false);
    expect(parseWithSchema(prSummarySchema, { ...ROW, repoId: "" }).ok).toBe(
      false,
    );
  });
});

describe("prSummarySchema draftPolicy on PR-meta", () => {
  it("accepts an absent draftPolicy on list rows", () => {
    const parsed = parseWithSchema(prSummarySchema, ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toBeUndefined();
  });

  it("parses a present draftPolicy", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draftPolicy: { generate: false, debounceSeconds: 900 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toEqual({
      generate: false,
      debounceSeconds: 900,
    });
  });

  it("reads the zero-config policy's null debounceSeconds as absent", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draftPolicy: { generate: true, debounceSeconds: null },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toStrictEqual({ generate: true });
  });

  it("rejects a malformed draftPolicy", () => {
    for (const bad of [
      { generate: "off", debounceSeconds: null },
      { generate: true, debounceSeconds: "900" },
      "off",
    ]) {
      const parsed = parseWithSchema(prSummarySchema, {
        ...ROW,
        draftPolicy: bad,
      });
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("prSummarySchema comparisons on PR-meta", () => {
  it("accepts an absent comparisons key and an empty envelope", () => {
    expect(parseWithSchema(prSummarySchema, ROW).ok).toBe(true);
    const empty = parseWithSchema(prSummarySchema, { ...ROW, comparisons: {} });
    expect(empty.ok).toBe(true);
    if (!empty.ok) {
      throw new Error("unreachable");
    }
    expect(empty.value.comparisons?.previousBrief).toBeUndefined();
  });

  it("parses previousBrief availability", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        previousBrief: {
          baselineSha: "head-0",
          baselineIndex: 1,
          narrativeAvailable: true,
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.comparisons?.previousBrief).toEqual({
      baselineSha: "head-0",
      baselineIndex: 1,
      narrativeAvailable: true,
    });
  });

  it("rejects a malformed previousBrief", () => {
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: { previousBrief: { baselineSha: 5 } },
      }).ok,
    ).toBe(false);
  });

  it("parses lastReview available payload, with and without baselineIndex", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        lastReview: {
          deltaAvailable: true,
          baselineSha: "cp-1",
          baselineIndex: 2,
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.comparisons?.lastReview).toEqual({
      kind: "available",
      deltaAvailable: true,
      baselineSha: "cp-1",
      baselineIndex: 2,
    });

    const noIndex = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        lastReview: { deltaAvailable: false, baselineSha: "cp-1" },
      },
    });
    expect(noIndex.ok).toBe(true);
    if (!noIndex.ok) {
      throw new Error("unreachable");
    }
    expect(noIndex.value.comparisons?.lastReview).toEqual({
      kind: "available",
      deltaAvailable: false,
      baselineSha: "cp-1",
    });
  });

  it("parses lastReview unavailable reasons, an unrecognised one as unknown", () => {
    for (const reason of ["pending", "baseline-unavailable"]) {
      const parsed = parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: { lastReview: { unavailable: reason } },
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error("unreachable");
      }
      expect(parsed.value.comparisons?.lastReview).toEqual({
        kind: "unavailable",
        reason,
      });
    }
    const unrecognised = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: { lastReview: { unavailable: "exploded" } },
    });
    if (!unrecognised.ok) {
      throw new Error(unrecognised.error);
    }
    expect(unrecognised.value.comparisons?.lastReview).toEqual({
      kind: "unavailable",
      reason: UnknownValues.UNKNOWN,
    });
  });

  it("rejects a malformed lastReview matching neither arm of the union", () => {
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: { lastReview: { baselineSha: "cp-1" } },
      }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: { lastReview: 5 },
      }).ok,
    ).toBe(false);
  });

  it("the unavailable key decides the arm even with an unrecognised reason", () => {
    const lastReview = {
      unavailable: "not-a-reason",
      deltaAvailable: true,
      baselineSha: "cp-1",
    };

    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: { lastReview },
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.comparisons?.lastReview).toEqual({
      kind: "unavailable",
      reason: UnknownValues.UNKNOWN,
    });
  });
});

describe("prSummarySchema degrade paths", () => {
  it("reads a mistyped failure code and a null wait reason as absent", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...PENDING_GENERATION, errorCode: 7, waitReason: null },
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation).not.toHaveProperty("errorCode");
    expect(parsed.value.generation).not.toHaveProperty("waitReason");
  });

  it("rejects a revision whose comparisons is null", () => {
    const revision = {
      headSha: "h",
      baseSha: "b",
      headIndex: 1,
      createdAt: "2026-07-06T12:00:00.000Z",
      comparisons: null,
    };

    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        briefAvailable: true,
        revisions: [revision],
      }).ok,
    ).toBe(false);
  });
});

describe("prSummarySchema revisions on PR-meta", () => {
  const REVISION = {
    headSha: "head-1",
    baseSha: "base-1",
    headIndex: 1,
    createdAt: "2026-07-06T12:00:00.000Z",
    comparisons: {},
  };

  it("reads a revision without comparisons as an empty envelope", () => {
    const { comparisons: _omitted, ...bare } = REVISION;
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      briefAvailable: true,
      revisions: [bare],
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.revisions?.[0]?.comparisons).toEqual({});
  });

  it("accepts an absent revisions key on a row with no brief", () => {
    const parsed = parseWithSchema(prSummarySchema, ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.revisions).toBeUndefined();
  });

  it("parses an ordered timeline preserving each entry's own baseSha", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      revisions: [
        { ...REVISION, headSha: "head-0", baseSha: "base-0", headIndex: 1 },
        // base drifts across revisions (base-branch advance / retarget), the
        // per-entry base must survive verbatim, never be borrowed.
        { ...REVISION, headSha: "head-1", baseSha: "base-1b", headIndex: 2 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.revisions).toEqual([
      {
        headSha: "head-0",
        baseSha: "base-0",
        headIndex: 1,
        createdAt: REVISION.createdAt,
        comparisons: {},
      },
      {
        headSha: "head-1",
        baseSha: "base-1b",
        headIndex: 2,
        createdAt: REVISION.createdAt,
        comparisons: {},
      },
    ]);
  });

  it("parses per-revision comparison availability, same envelope as above", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      revisions: [
        {
          ...REVISION,
          comparisons: {
            previousBrief: {
              baselineSha: "head-0",
              baselineIndex: 1,
              narrativeAvailable: false,
            },
            lastReview: { unavailable: "baseline-unavailable" },
          },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const revision = parsed.value.revisions?.[0];
    expect(revision?.comparisons.previousBrief?.baselineSha).toBe("head-0");
    expect(revision?.comparisons.lastReview).toEqual({
      kind: "unavailable",
      reason: "baseline-unavailable",
    });
  });

  it("carries generatedAt through, tolerates absence, rejects non-string", () => {
    const withCutoff = parseWithSchema(prSummarySchema, {
      ...ROW,
      revisions: [{ ...REVISION, generatedAt: "2026-07-06T11:58:00.000Z" }],
    });
    expect(withCutoff.ok).toBe(true);
    if (!withCutoff.ok) {
      throw new Error("unreachable");
    }
    expect(withCutoff.value.revisions?.[0]?.generatedAt).toBe(
      "2026-07-06T11:58:00.000Z",
    );

    const absent = parseWithSchema(prSummarySchema, {
      ...ROW,
      revisions: [REVISION],
    });
    expect(absent.ok).toBe(true);
    if (!absent.ok) {
      throw new Error("unreachable");
    }
    expect(absent.value.revisions?.[0]?.generatedAt).toBeUndefined();

    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        revisions: [{ ...REVISION, generatedAt: 5 }],
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-array revisions and a malformed entry", () => {
    expect(parseWithSchema(prSummarySchema, { ...ROW, revisions: {} }).ok).toBe(
      false,
    );
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        revisions: [{ ...REVISION, headIndex: "2" }],
      }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        revisions: [{ ...REVISION, comparisons: { lastReview: 5 } }],
      }).ok,
    ).toBe(false);
  });
});

describe("pullStackSchema", () => {
  it("parses a null stack as none, a chain and a fork", () => {
    expect(parseWithSchema(pullStackSchema, { stack: null })).toStrictEqual({
      ok: true,
      value: {},
    });
    const chain = {
      members: [
        { number: 6, title: "Bottom" },
        { number: 7, title: "Top" },
      ],
      index: 2,
    };
    expect(parseWithSchema(pullStackSchema, { stack: chain })).toEqual({
      ok: true,
      value: { stack: chain },
    });
    const fork = {
      parent: { number: 6, title: "Bottom" },
      children: [
        { number: 8, title: "Left" },
        { number: 9, title: "Right" },
      ],
    };
    expect(parseWithSchema(pullStackSchema, { stack: fork })).toEqual({
      ok: true,
      value: { stack: fork },
    });
    expect(
      parseWithSchema(pullStackSchema, { stack: { children: fork.children } }),
    ).toEqual({
      ok: true,
      value: { stack: { children: fork.children } },
    });
  });

  it("keeps the recorded read time and refuses an unreadable one", () => {
    const chain = { members: [{ number: 6, title: "x" }], index: 1 };
    const asOf = "2026-09-19T12:00:00.000Z";
    expect(parseWithSchema(pullStackSchema, { stack: chain, asOf })).toEqual({
      ok: true,
      value: { stack: chain, asOf },
    });
    expect(parseWithSchema(pullStackSchema, { stack: chain, asOf: 5 }).ok).toBe(
      false,
    );
    expect(
      parseWithSchema(pullStackSchema, { stack: chain, asOf: "garbage" }).ok,
    ).toBe(false);
  });

  it("refuses a malformed member or a missing index", () => {
    expect(
      parseWithSchema(pullStackSchema, {
        stack: { members: [{ number: "6", title: "x" }], index: 1 },
      }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(pullStackSchema, {
        stack: { members: [{ number: 6, title: "x" }] },
      }).ok,
    ).toBe(false);
    expect(parseWithSchema(pullStackSchema, { stack: "nope" }).ok).toBe(false);
    expect(parseWithSchema(pullStackSchema, []).ok).toBe(false);
  });

  it("refuses an invalid chain even when it also carries children", () => {
    const stack = {
      members: [{ number: "6", title: "x" }],
      index: 1,
      children: [{ number: 8, title: "Left" }],
    };

    expect(parseWithSchema(pullStackSchema, { stack }).ok).toBe(false);
  });
});

const SCHEMA_PINS = {
  GenerationSummary: true satisfies Equals<
    z.output<typeof generationSummarySchema>,
    GenerationSummary
  >,
  PreviousBriefComparison: true satisfies Equals<
    z.output<typeof previousBriefComparisonSchema>,
    PreviousBriefComparison
  >,
  LastReviewComparison: true satisfies Equals<
    z.output<typeof lastReviewComparisonSchema>,
    LastReviewComparison
  >,
  AvailableLastReviewComparison: true satisfies Equals<
    z.output<typeof availableLastReviewSchema>,
    AvailableLastReviewComparison
  >,
  UnavailableLastReviewComparison: true satisfies Equals<
    z.output<typeof unavailableLastReviewSchema>,
    UnavailableLastReviewComparison
  >,
  PrComparisons: true satisfies Equals<
    z.output<typeof prComparisonsSchema>,
    PrComparisons
  >,
  RevisionSummary: true satisfies Equals<
    z.output<typeof revisionSummarySchema>,
    RevisionSummary
  >,
  DraftPolicySummary: true satisfies Equals<
    z.output<typeof draftPolicySummarySchema>,
    DraftPolicySummary
  >,
  PrSummary: true satisfies Equals<z.output<typeof prSummarySchema>, PrSummary>,
  PrStackMember: true satisfies Equals<
    z.output<typeof prStackMemberSchema>,
    PrStackMember
  >,
  LinearPrStack: true satisfies Equals<
    z.output<typeof linearPrStackSchema>,
    LinearPrStack
  >,
  ForkPrStack: true satisfies Equals<
    z.output<typeof forkPrStackSchema>,
    ForkPrStack
  >,
  PullStack: true satisfies Equals<z.output<typeof pullStackSchema>, PullStack>,
} as const;

describe("pulls schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});

type UnavailableLastReviewView = Extract<
  LastReviewComparisonView,
  { readonly unavailable: unknown }
>;

const CONTRACT_PINS = {
  // `errorDetail` is lifted out of the wire's `errorParams.detail`.
  GenerationSummary: true satisfies ReadsWireFields<
    Omit<z.output<typeof generationSummarySchema>, "errorDetail">,
    GenerationSummaryView
  >,
  PreviousBriefComparison: true satisfies ReadsWireFields<
    z.output<typeof previousBriefComparisonSchema>,
    PreviousBriefComparisonView
  >,
  UnavailableLastReviewComparison: true satisfies ReadsWireFields<
    z.input<typeof unavailableLastReviewSchema>,
    UnavailableLastReviewView
  >,
  PrComparisons: true satisfies ReadsWireFields<
    z.output<typeof prComparisonsSchema>,
    RevisionComparisons
  >,
  RevisionSummary: true satisfies ReadsWireFields<
    z.output<typeof revisionSummarySchema>,
    RevisionView
  >,
  DraftPolicySummary: true satisfies ReadsWireFields<
    z.output<typeof draftPolicySummarySchema>,
    DraftPolicy
  >,
  PrSummary: true satisfies ReadsWireFields<
    z.output<typeof prSummarySchema>,
    PullMetaView
  >,
  PrStackMember: true satisfies ReadsWireFields<
    z.output<typeof prStackMemberSchema>,
    PrStackMemberView
  >,
  LinearPrStack: true satisfies ReadsWireFields<
    z.output<typeof linearPrStackSchema>,
    LinearPrStackView
  >,
  ForkPrStack: true satisfies ReadsWireFields<
    z.output<typeof forkPrStackSchema>,
    ForkPrStackView
  >,
  PullStack: true satisfies ReadsWireFields<
    z.output<typeof pullStackSchema>,
    PullStackView
  >,
} as const;

describe("pulls schemas read only what the contract sends", () => {
  it.each(Object.entries(CONTRACT_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
