// Boundary-guard tests for the read-API PR shapes. The API is trusted
// infrastructure but still an external boundary to this bundle, so responses
// are parsed, never cast.
import {
  WaitReasons,
  type ForkPrStackView,
  type GenerationSummaryView,
  type LastReviewComparisonView,
  type AvailablePreviousBriefComparisonView,
  type LinearPrStackView,
  type UnavailablePreviousBriefComparisonView,
  type PrStackMemberView,
  type PullMetaView,
  type PullStackView,
  type RevisionComparisons,
  type RevisionView,
  type VideoAssetsResponse,
} from "contract";
import { describe, expect, it } from "vitest";
import type { DraftPolicy, Equals } from "types";
import type { z } from "zod/v4";

import { UnknownValues } from "@web/utils/open-enum/types";
import { ATTACHMENT_ASSET_ID } from "@web/test/attachments";
import type { ReadsWireFields } from "@web/test/wire-fields";
import { parseWithSchema } from "@web/utils/parse-with-schema";
import {
  type availableLastReviewSchema,
  type availablePreviousBriefSchema,
  type briefLayoutReplySchema,
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
  type unavailablePreviousBriefSchema,
  type unmetConditionSchema,
  videoAssetsSchema,
} from "./schemas";
import type {
  ForkPrStack,
  LinearPrStack,
  PrStackMember,
  PullStack,
} from "@web/features/brief/model";
import type { HeldCondition } from "./components/PrBrief/held-head/types";
import type {
  BriefLayoutReply,
  AvailableLastReviewComparison,
  AvailablePreviousBriefComparison,
  DraftPolicySummary,
  GenerationSummary,
  LastReviewComparison,
  PrComparisons,
  PreviousBriefComparison,
  PrSummary,
  RevisionSummary,
  UnavailableLastReviewComparison,
  UnavailablePreviousBriefComparison,
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

  it("lifts the runs a capped large run needed off the wire", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        status: "capped",
        phase: null,
        attempts: 0,
        errorCode: null,
        errorParams: { needed: 9, left: 4, cap: 20 },
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation?.cappedUnits).toEqual({
      needed: 9,
      left: 4,
      cap: 20,
    });
  });

  it("drops capped units that are not two numbers", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        status: "capped",
        phase: null,
        attempts: 0,
        errorCode: null,
        errorParams: { needed: "nine", left: 4, cap: 20 },
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.generation).not.toHaveProperty("cappedUnits");
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

  it("parses viewerCanPush and fails closed when it is absent", () => {
    const pusher = parseWithSchema(prSummarySchema, {
      ...ROW,
      viewerCanPush: true,
    });
    if (!pusher.ok) {
      throw new Error("unreachable");
    }
    expect(pusher.value.viewerCanPush).toBe(true);

    const older = parseWithSchema(prSummarySchema, ROW);
    if (!older.ok) {
      throw new Error("unreachable");
    }
    expect(older.value.viewerCanPush).toBe(false);

    expect(
      parseWithSchema(prSummarySchema, { ...ROW, viewerCanPush: "true" }).ok,
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
  it("parses a present draftPolicy", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draftPolicy: { debounceSeconds: 900 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toEqual({ debounceSeconds: 900 });
  });

  it("reads the zero-config policy's null debounceSeconds as absent", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draftPolicy: { debounceSeconds: null },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toStrictEqual({});
  });

  it("drops the generate switch an older server still sends", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      draftPolicy: { generate: false, debounceSeconds: 900 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.draftPolicy).toStrictEqual({ debounceSeconds: 900 });
  });

  it("rejects a malformed draftPolicy", () => {
    for (const bad of [{ debounceSeconds: "900" }, "off"]) {
      const parsed = parseWithSchema(prSummarySchema, {
        ...ROW,
        draftPolicy: bad,
      });
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("prSummarySchema comparisons on PR-meta", () => {
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
      kind: "available",
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

  it("parses a lastReview whose delta was skipped as too large", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        lastReview: {
          deltaAvailable: false,
          deltaSkipped: true,
          baselineSha: "cp-1",
        },
      },
    });

    expect(parsed.ok && parsed.value.comparisons?.lastReview).toEqual({
      kind: "available",
      deltaAvailable: false,
      deltaSkipped: true,
      baselineSha: "cp-1",
    });
  });

  it("parses the no-change flags on both comparisons", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        previousBrief: {
          baselineSha: "h-1",
          baselineIndex: 1,
          narrativeAvailable: true,
          unchanged: true,
        },
        lastReview: {
          deltaAvailable: false,
          deltaUnchanged: true,
          baselineSha: "cp-1",
        },
      },
    });

    expect(parsed.ok && parsed.value.comparisons).toEqual({
      previousBrief: {
        kind: "available",
        baselineSha: "h-1",
        baselineIndex: 1,
        narrativeAvailable: true,
        unchanged: true,
      },
      lastReview: {
        kind: "available",
        deltaAvailable: false,
        deltaUnchanged: true,
        baselineSha: "cp-1",
      },
    });
  });

  it("reads previousBrief unavailable reasons, a new one as unknown", () => {
    for (const reason of [
      "pending",
      "baseline-unavailable",
      "span-too-large",
    ]) {
      const parsed = parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: {
          previousBrief: {
            baselineSha: "h-1",
            baselineIndex: 1,
            unavailable: reason,
          },
        },
      });
      expect(parsed.ok && parsed.value.comparisons?.previousBrief).toEqual({
        kind: "unavailable",
        baselineSha: "h-1",
        baselineIndex: 1,
        reason,
      });
    }
    const unrecognised = parseWithSchema(prSummarySchema, {
      ...ROW,
      comparisons: {
        previousBrief: {
          baselineSha: "h-1",
          baselineIndex: 1,
          unavailable: "exploded",
        },
      },
    });
    expect(
      unrecognised.ok && unrecognised.value.comparisons?.previousBrief,
    ).toEqual({
      kind: "unavailable",
      baselineSha: "h-1",
      baselineIndex: 1,
      reason: UnknownValues.UNKNOWN,
    });
  });

  it("rejects a previousBrief carrying both arms' fields", () => {
    expect(
      parseWithSchema(prSummarySchema, {
        ...ROW,
        comparisons: {
          previousBrief: {
            baselineSha: "h-1",
            baselineIndex: 1,
            narrativeAvailable: true,
            unavailable: "pending",
          },
        },
      }).ok,
    ).toBe(false);
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

describe("pullStackSchema live details", () => {
  const chain = {
    members: [
      { number: 6, title: "Base", state: "open", headRef: "feature/base" },
      { number: 7, title: "Tip", state: "draft", headRef: "feature/tip" },
    ],
    index: 1,
    baseRef: "main",
  };

  it("carries each member's state and branch and the stack's base", () => {
    expect(parseWithSchema(pullStackSchema, { stack: chain })).toEqual({
      ok: true,
      value: { stack: chain },
    });
    const fork = {
      parent: chain.members[0],
      children: [chain.members[1]],
      baseRef: "main",
    };
    expect(parseWithSchema(pullStackSchema, { stack: fork })).toEqual({
      ok: true,
      value: { stack: fork },
    });
  });

  it("reads a state this bundle predates as unknown", () => {
    const members = [{ number: 6, title: "Base", state: "merged" }];
    expect(
      parseWithSchema(pullStackSchema, { stack: { members, index: 1 } }),
    ).toEqual({
      ok: true,
      value: {
        stack: {
          members: [{ number: 6, title: "Base", state: UnknownValues.UNKNOWN }],
          index: 1,
        },
      },
    });
  });

  it("refuses a branch or base that is not a string", () => {
    const members = [{ number: 6, title: "Base", headRef: 6 }];
    expect(
      parseWithSchema(pullStackSchema, { stack: { members, index: 1 } }).ok,
    ).toBe(false);
    expect(
      parseWithSchema(pullStackSchema, {
        stack: {
          members: [{ number: 6, title: "Base" }],
          index: 1,
          baseRef: 1,
        },
      }).ok,
    ).toBe(false);
  });
});

describe("videoAssetsSchema", () => {
  const ASSET_ID = ATTACHMENT_ASSET_ID;

  it("reads the asset ids github rendered as a video", () => {
    const parsed = videoAssetsSchema.safeParse({ assetIds: [ASSET_ID] });

    expect(parsed.data).toEqual({ assetIds: [ASSET_ID] });
  });

  it("refuses an id that is no asset id", () => {
    const parsed = videoAssetsSchema.safeParse({
      assetIds: [ASSET_ID, "../secret"],
    });

    expect(parsed.success).toBe(false);
  });
});

const HELD_GENERATION = { ...PENDING_GENERATION, status: "held" };

const READY_ITEM = { kind: "ready-for-review", source: "instance" };
const CI_ITEM = {
  kind: "ci",
  source: "repo",
  failed: [],
  running: ["build"],
  missing: [],
  permissionMissing: false,
};
const BOT_ITEM = {
  kind: "bots",
  source: "repo",
  bot: "coderabbit",
  verdict: "approved",
  state: "issues",
  issues: 2,
};

function parseHeldGeneration(unmetConditions: unknown) {
  const parsed = parseWithSchema(prSummarySchema, {
    ...ROW,
    generation: { ...HELD_GENERATION, unmetConditions },
  });
  if (!parsed.ok) {
    throw new Error("unreachable");
  }
  return parsed.value.generation;
}

function parseHeldConditions(unmetConditions: unknown) {
  return parseHeldGeneration(unmetConditions)?.unmetConditions;
}

describe("generationSummarySchema unmetConditions", () => {
  it("reads every plain kind and an any group", () => {
    const wire = [
      READY_ITEM,
      { kind: "never", source: "repo" },
      { kind: "review-requested", source: "repo" },
      {
        kind: "size",
        source: "instance",
        count: "changed-lines",
        side: "max",
        limit: 800,
        actual: 1284,
      },
      { kind: "labels", source: "repo", labels: ["needs-brief"] },
      { kind: "title-keywords", source: "repo", keywords: ["brief"] },
      {
        kind: "base-branches",
        source: "repo",
        base: "dev",
        branches: ["main"],
      },
      { kind: "paths", source: "repo", paths: ["src/**"] },
      BOT_ITEM,
      CI_ITEM,
      { kind: "any", conditions: [READY_ITEM, CI_ITEM] },
    ];

    const generation = parseHeldGeneration(wire);

    expect(generation?.unmetConditions).toStrictEqual(wire);
    expect(generation).not.toHaveProperty("unmetConditionsPartial");
  });

  it("keeps a bot item whose verdict this bundle predates", () => {
    const generation = parseHeldGeneration([
      { ...BOT_ITEM, verdict: "merged" },
    ]);

    expect(generation?.unmetConditions).toStrictEqual([
      { ...BOT_ITEM, verdict: UnknownValues.UNKNOWN },
    ]);
    expect(generation).not.toHaveProperty("unmetConditionsPartial");
  });

  it("marks the list partial when it drops an item", () => {
    const generation = parseHeldGeneration([
      { kind: "deploy-window", source: "repo" },
      CI_ITEM,
    ]);

    expect(generation?.unmetConditions).toStrictEqual([CI_ITEM]);
    expect(generation?.unmetConditionsPartial).toBe(true);
  });

  it("marks the list partial when an any group drops a member", () => {
    const generation = parseHeldGeneration([
      { kind: "any", conditions: [{ kind: "mystery" }, CI_ITEM] },
    ]);

    expect(generation?.unmetConditionsPartial).toBe(true);
  });

  it("keeps the partial mark a server sends after dropping an item", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        ...HELD_GENERATION,
        unmetConditions: [CI_ITEM],
        unmetConditionsPartial: true,
      },
    });

    const generation = parsed.ok ? parsed.value.generation : undefined;
    expect(generation?.unmetConditions).toStrictEqual([CI_ITEM]);
    expect(generation?.unmetConditionsPartial).toBe(true);
  });

  it("keeps the server's partial mark when it sends no readable item", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...HELD_GENERATION, unmetConditionsPartial: true },
    });

    const generation = parsed.ok ? parsed.value.generation : undefined;
    expect(generation).not.toHaveProperty("unmetConditions");
    expect(generation?.unmetConditionsPartial).toBe(true);
  });

  it("reads no partial mark the server leaves off", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: {
        ...HELD_GENERATION,
        unmetConditions: [CI_ITEM],
        unmetConditionsPartial: false,
      },
    });

    expect(parsed.ok && parsed.value.generation).not.toHaveProperty(
      "unmetConditionsPartial",
    );
  });

  it("drops an item of a kind this bundle predates and keeps the rest", () => {
    const unmet = parseHeldConditions([
      { kind: "deploy-window", source: "repo" },
      READY_ITEM,
    ]);

    expect(unmet).toStrictEqual([READY_ITEM]);
  });

  it.each([
    ["bot", { ...BOT_ITEM, bot: "reviewatron" }],
    ["bot state", { ...BOT_ITEM, state: "sleeping" }],
    ["source", { ...READY_ITEM, source: "org" }],
    [
      "size count",
      {
        kind: "size",
        source: "repo",
        count: "files",
        side: "max",
        limit: 1,
        actual: 2,
      },
    ],
  ])("drops an item whose %s this bundle predates", (_field, item) => {
    const generation = parseHeldGeneration([item, CI_ITEM]);

    expect(generation?.unmetConditions).toStrictEqual([CI_ITEM]);
    expect(generation?.unmetConditionsPartial).toBe(true);
  });

  it("keeps an any group's known members and drops the unknown one", () => {
    const unmet = parseHeldConditions([
      { kind: "any", conditions: [{ kind: "mystery" }, READY_ITEM] },
    ]);

    expect(unmet).toStrictEqual([{ kind: "any", conditions: [READY_ITEM] }]);
  });

  it("drops an any group with no member this bundle reads", () => {
    const unmet = parseHeldConditions([
      READY_ITEM,
      { kind: "any", conditions: [{ kind: "mystery" }] },
    ]);

    expect(unmet).toStrictEqual([READY_ITEM]);
  });

  it("drops a list that is not a list and keeps the meta", () => {
    const parsed = parseWithSchema(prSummarySchema, {
      ...ROW,
      generation: { ...HELD_GENERATION, unmetConditions: "nope" },
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.generation?.status).toBe("held");
    expect(parsed.ok && parsed.value.generation).not.toHaveProperty(
      "unmetConditions",
    );
  });
});

const SCHEMA_PINS = {
  HeldCondition: true satisfies Equals<
    z.output<typeof unmetConditionSchema>,
    HeldCondition
  >,
  VideoAssetsResponse: true satisfies Equals<
    z.output<typeof videoAssetsSchema>,
    VideoAssetsResponse
  >,
  GenerationSummary: true satisfies Equals<
    z.output<typeof generationSummarySchema>,
    GenerationSummary
  >,
  PreviousBriefComparison: true satisfies Equals<
    z.output<typeof previousBriefComparisonSchema>,
    PreviousBriefComparison
  >,
  AvailablePreviousBriefComparison: true satisfies Equals<
    z.output<typeof availablePreviousBriefSchema>,
    AvailablePreviousBriefComparison
  >,
  UnavailablePreviousBriefComparison: true satisfies Equals<
    z.output<typeof unavailablePreviousBriefSchema>,
    UnavailablePreviousBriefComparison
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
  BriefLayoutReply: true satisfies Equals<
    z.output<typeof briefLayoutReplySchema>,
    BriefLayoutReply
  >,
} as const;

void SCHEMA_PINS;

type UnavailableLastReviewView = Extract<
  LastReviewComparisonView,
  { readonly unavailable: unknown }
>;

const CONTRACT_PINS = {
  // `errorDetail` and `cappedUnits` are lifted out of the wire's `errorParams`.
  GenerationSummary: true satisfies ReadsWireFields<
    Omit<
      z.output<typeof generationSummarySchema>,
      "errorDetail" | "cappedUnits"
    >,
    GenerationSummaryView
  >,
  // `narrativeAvailable` is read only to refuse it on this arm.
  UnavailablePreviousBriefComparison: true satisfies ReadsWireFields<
    Omit<z.input<typeof unavailablePreviousBriefSchema>, "narrativeAvailable">,
    UnavailablePreviousBriefComparisonView
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

void CONTRACT_PINS;

// The FE re-keys the wire union by `kind`, so only the available branch's
// payload must match the contract field for field.
true satisfies Equals<
  Omit<Extract<LastReviewComparison, { kind: "available" }>, "kind">,
  Exclude<LastReviewComparisonView, { readonly unavailable: unknown }>
>;

true satisfies Equals<
  Omit<AvailablePreviousBriefComparison, "kind">,
  AvailablePreviousBriefComparisonView
>;

// `stack` is the FE's own mutable PrStack, so the pin stops at the key set
// and `asOf`.
true satisfies Equals<keyof PullStack, keyof PullStackView>;
true satisfies Equals<PullStack["asOf"], PullStackView["asOf"]>;
