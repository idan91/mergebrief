// Boundary-guard tests for the read-API PR shapes. The API is trusted
// infrastructure but still an external boundary to this bundle, so responses
// are parsed, never cast.
import { describe, expect, it } from "vitest";
import { WaitReasons, type LastReviewComparisonView } from "contract";
import type { Equals } from "types/utils";
import {
  parsePrSummary,
  parsePullsList,
  parsePullStack,
  type LastReviewComparison,
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

describe("parsePrSummary behind", () => {
  it("reads behind when present and treats an older server as caught up", () => {
    const behind = parsePrSummary({ ...ROW, behind: true });
    const absent = parsePrSummary(ROW);
    const wrong = parsePrSummary({ ...ROW, behind: "yes" });

    expect(behind.ok && behind.value.behind).toBe(true);
    expect(absent.ok && absent.value.behind).toBe(false);
    expect(wrong.ok).toBe(false);
  });
});

describe("parsePrSummary", () => {
  it("parses the failure code and sanitized detail off the wire", () => {
    const parsed = parsePrSummary({
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
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.generation?.errorCode).toBe("provider-rate-limit");
    expect(parsed.value.generation?.errorDetail).toBe("429 from the provider");
  });

  it("degrades a code this bundle does not know, keeping the detail", () => {
    const parsed = parsePrSummary({
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
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.generation?.errorCode).toBeNull();
    expect(parsed.value.generation?.errorDetail).toBe("cap reached");
  });

  it("rejects a non-object errorParams and ignores a non-string detail", () => {
    const base = {
      status: "failed",
      phase: null,
      attempts: 1,
      errorCode: "unknown",
      updatedAt: "2026-07-06T12:00:00.000Z",
    };
    expect(
      parsePrSummary({ ...ROW, generation: { ...base, errorParams: "nope" } })
        .ok,
    ).toBe(false);
    const loose = parsePrSummary({
      ...ROW,
      generation: { ...base, errorParams: { detail: 5 } },
    });
    if (!loose.ok) throw new Error("unreachable");
    expect(loose.value.generation?.errorDetail).toBeNull();
  });

  it("parses a known wait reason off a pending generation", () => {
    const parsed = parsePrSummary({
      ...ROW,
      generation: { ...PENDING_GENERATION, waitReason: "waiting-for-slot" },
    });

    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.generation?.waitReason).toBe(
      WaitReasons.WAITING_FOR_SLOT,
    );
  });

  it("leaves the wait reason absent when the wire carries none", () => {
    const parsed = parsePrSummary({ ...ROW, generation: PENDING_GENERATION });

    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.generation).not.toHaveProperty("waitReason");
  });

  it("degrades a wait reason this bundle does not know to absent", () => {
    const parsed = parsePrSummary({
      ...ROW,
      generation: { ...PENDING_GENERATION, waitReason: "rate-limited" },
    });

    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.generation).not.toHaveProperty("waitReason");
  });

  it("accepts a full row", () => {
    const parsed = parsePrSummary(ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.prNumber).toBe(7);
    expect(parsed.value.generation?.status).toBe("succeeded");
  });

  it("parses draft + viewerIsAuthor and requires both", () => {
    const parsed = parsePrSummary({
      ...ROW,
      draft: true,
      viewerIsAuthor: true,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.draft).toBe(true);
    expect(parsed.value.viewerIsAuthor).toBe(true);

    const { draft: _noDraft, ...withoutDraft } = ROW;
    expect(parsePrSummary(withoutDraft).ok).toBe(false);
    const { viewerIsAuthor: _noViewer, ...withoutViewer } = ROW;
    expect(parsePrSummary(withoutViewer).ok).toBe(false);
    // A non-boolean must be rejected, not coerced, this gates affordances.
    expect(parsePrSummary({ ...ROW, viewerIsAuthor: "true" }).ok).toBe(false);
  });

  it("parses viewerCanResolve and FAILS CLOSED when it is absent", () => {
    const capable = parsePrSummary({ ...ROW, viewerCanResolve: true });
    expect(capable.ok).toBe(true);
    if (!capable.ok) throw new Error("unreachable");
    expect(capable.value.viewerCanResolve).toBe(true);

    const denied = parsePrSummary({ ...ROW, viewerCanResolve: false });
    if (!denied.ok) throw new Error("unreachable");
    expect(denied.value.viewerCanResolve).toBe(false);

    // Absent = a server predating the field: no capability, so no affordance.
    // Unlike draft/viewerIsAuthor this is NOT a contract violation, the row
    // parses, it just carries no permission.
    const older = parsePrSummary(ROW);
    if (!older.ok) throw new Error("unreachable");
    expect(older.value.viewerCanResolve).toBe(false);

    // Present but not a boolean IS malformed, coercing a truthy string into a
    // capability would hand out affordances the server never granted.
    expect(parsePrSummary({ ...ROW, viewerCanResolve: "true" }).ok).toBe(false);
    expect(parsePrSummary({ ...ROW, viewerCanResolve: null }).ok).toBe(false);
  });

  it("accepts nullable fields on a waiting row with no brief and no title", () => {
    const parsed = parsePrSummary({
      ...ROW,
      title: null,
      baseSha: null,
      headSha: null,
      briefAvailable: false,
      generation: null,
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects an unknown generation status", () => {
    const parsed = parsePrSummary({
      ...ROW,
      generation: { ...ROW.generation, status: "exploded" },
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { prNumber: _dropped, ...rest } = ROW;
    expect(parsePrSummary(rest).ok).toBe(false);
  });

  it("rejects an unknown state", () => {
    expect(parsePrSummary({ ...ROW, state: "reopened" }).ok).toBe(false);
  });

  it("rejects a non-numeric repoId, which is interpolated into route URLs", () => {
    expect(parsePrSummary({ ...ROW, repoId: "123/extra" }).ok).toBe(false);
    expect(parsePrSummary({ ...ROW, repoId: "?x=1" }).ok).toBe(false);
    expect(parsePrSummary({ ...ROW, repoId: "" }).ok).toBe(false);
  });
});

describe("parsePrSummary draftPolicy on PR-meta", () => {
  it("accepts an absent draftPolicy on list rows", () => {
    const parsed = parsePrSummary(ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.draftPolicy).toBeUndefined();
  });

  it("parses a present draftPolicy", () => {
    const parsed = parsePrSummary({
      ...ROW,
      draftPolicy: { generate: false, debounceSeconds: 900 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.draftPolicy).toEqual({
      generate: false,
      debounceSeconds: 900,
    });
  });

  it("parses the zero-config policy with a null debounceSeconds", () => {
    const parsed = parsePrSummary({
      ...ROW,
      draftPolicy: { generate: true, debounceSeconds: null },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.draftPolicy).toEqual({
      generate: true,
      debounceSeconds: null,
    });
  });

  it("rejects a malformed draftPolicy", () => {
    for (const bad of [
      { generate: "off", debounceSeconds: null },
      { generate: true, debounceSeconds: "900" },
      { generate: true },
      "off",
    ]) {
      const parsed = parsePrSummary({ ...ROW, draftPolicy: bad });
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("parsePrSummary comparisons on PR-meta", () => {
  it("accepts an absent comparisons key and an empty envelope", () => {
    expect(parsePrSummary(ROW).ok).toBe(true);
    const empty = parsePrSummary({ ...ROW, comparisons: {} });
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error("unreachable");
    expect(empty.value.comparisons?.previousBrief).toBeUndefined();
  });

  it("parses previousBrief availability", () => {
    const parsed = parsePrSummary({
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
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.comparisons?.previousBrief).toEqual({
      baselineSha: "head-0",
      baselineIndex: 1,
      narrativeAvailable: true,
    });
  });

  it("rejects a malformed previousBrief", () => {
    expect(
      parsePrSummary({
        ...ROW,
        comparisons: { previousBrief: { baselineSha: 5 } },
      }).ok,
    ).toBe(false);
  });

  it("parses lastReview available payload, with and without baselineIndex", () => {
    const parsed = parsePrSummary({
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
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.comparisons?.lastReview).toEqual({
      kind: "available",
      deltaAvailable: true,
      baselineSha: "cp-1",
      baselineIndex: 2,
    });

    const noIndex = parsePrSummary({
      ...ROW,
      comparisons: {
        lastReview: { deltaAvailable: false, baselineSha: "cp-1" },
      },
    });
    expect(noIndex.ok).toBe(true);
    if (!noIndex.ok) throw new Error("unreachable");
    expect(noIndex.value.comparisons?.lastReview).toEqual({
      kind: "available",
      deltaAvailable: false,
      baselineSha: "cp-1",
    });
  });

  it("parses lastReview unavailable reasons and rejects unknown ones", () => {
    for (const reason of ["pending", "baseline-unavailable"]) {
      const parsed = parsePrSummary({
        ...ROW,
        comparisons: { lastReview: { unavailable: reason } },
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("unreachable");
      expect(parsed.value.comparisons?.lastReview).toEqual({
        kind: "unavailable",
        reason,
      });
    }
    expect(
      parsePrSummary({
        ...ROW,
        comparisons: { lastReview: { unavailable: "exploded" } },
      }).ok,
    ).toBe(false);
  });

  it("rejects a malformed lastReview matching neither arm of the union", () => {
    expect(
      parsePrSummary({
        ...ROW,
        comparisons: { lastReview: { baselineSha: "cp-1" } },
      }).ok,
    ).toBe(false);
    expect(parsePrSummary({ ...ROW, comparisons: { lastReview: 5 } }).ok).toBe(
      false,
    );
  });
});

describe("parsePrSummary revisions on PR-meta", () => {
  const REVISION = {
    headSha: "head-1",
    baseSha: "base-1",
    headIndex: 1,
    createdAt: "2026-07-06T12:00:00.000Z",
    comparisons: {},
  };

  it("accepts an absent revisions key on a row with no brief", () => {
    const parsed = parsePrSummary(ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.revisions).toBeUndefined();
  });

  it("parses an ordered timeline preserving each entry's own baseSha", () => {
    const parsed = parsePrSummary({
      ...ROW,
      revisions: [
        { ...REVISION, headSha: "head-0", baseSha: "base-0", headIndex: 1 },
        // base drifts across revisions (base-branch advance / retarget), the
        // per-entry base must survive verbatim, never be borrowed.
        { ...REVISION, headSha: "head-1", baseSha: "base-1b", headIndex: 2 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
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
    const parsed = parsePrSummary({
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
    if (!parsed.ok) throw new Error("unreachable");
    const revision = parsed.value.revisions?.[0];
    expect(revision?.comparisons.previousBrief?.baselineSha).toBe("head-0");
    expect(revision?.comparisons.lastReview).toEqual({
      kind: "unavailable",
      reason: "baseline-unavailable",
    });
  });

  it("carries generatedAt through, tolerates absence, rejects non-string", () => {
    const withCutoff = parsePrSummary({
      ...ROW,
      revisions: [{ ...REVISION, generatedAt: "2026-07-06T11:58:00.000Z" }],
    });
    expect(withCutoff.ok).toBe(true);
    if (!withCutoff.ok) throw new Error("unreachable");
    expect(withCutoff.value.revisions?.[0]?.generatedAt).toBe(
      "2026-07-06T11:58:00.000Z",
    );

    const absent = parsePrSummary({ ...ROW, revisions: [REVISION] });
    expect(absent.ok).toBe(true);
    if (!absent.ok) throw new Error("unreachable");
    expect(absent.value.revisions?.[0]?.generatedAt).toBeUndefined();

    expect(
      parsePrSummary({ ...ROW, revisions: [{ ...REVISION, generatedAt: 5 }] })
        .ok,
    ).toBe(false);
  });

  it("rejects a non-array revisions and a malformed entry", () => {
    expect(parsePrSummary({ ...ROW, revisions: {} }).ok).toBe(false);
    expect(
      parsePrSummary({
        ...ROW,
        revisions: [{ ...REVISION, headIndex: "2" }],
      }).ok,
    ).toBe(false);
    expect(
      parsePrSummary({
        ...ROW,
        revisions: [{ ...REVISION, comparisons: { lastReview: 5 } }],
      }).ok,
    ).toBe(false);
  });
});

describe("parsePullsList", () => {
  it("accepts { pulls: [...] } and rejects a bare array", () => {
    const ok = parsePullsList({ pulls: [ROW] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    expect(ok.value).toHaveLength(1);

    expect(parsePullsList([ROW]).ok).toBe(false);
  });

  it("rejects a list containing one malformed row", () => {
    expect(parsePullsList({ pulls: [ROW, { nope: true }] }).ok).toBe(false);
  });
});

// The contract's `lastReview` union, minus its unavailable branch: the
// payload the FE's `available` branch mirrors field for field.
type SourceAvailableLastReview = Exclude<
  LastReviewComparisonView,
  { readonly unavailable: unknown }
>;
/**
 * The FE re-shapes the wire union into a discriminated one (`kind`) so
 * consumers switch without re-probing keys, so the two unions are NOT
 * identical by design, but the available branch's PAYLOAD must be. `Equals`
 * is exact: it fails on a renamed or retyped field, and unlike mutual
 * assignability it also fails when the OPTIONAL `baselineIndex` half drifts.
 */
const availableBranchPin: Equals<
  Omit<Extract<LastReviewComparison, { kind: "available" }>, "kind">,
  SourceAvailableLastReview
> = true;

describe("lockstep pin against the wire contract", () => {
  it("the available lastReview branch mirrors the contract payload exactly", () => {
    // Compile-time pin (gated by `pnpm -C apps/web typecheck`, which includes
    // test files); asserted at runtime so it stays visible in the suite.
    expect(availableBranchPin).toBe(true);
  });
});

describe("parsePullStack", () => {
  it("parses a null stack, a chain and a fork", () => {
    expect(parsePullStack({ stack: null })).toEqual({ ok: true, value: null });
    const chain = {
      members: [
        { number: 6, title: "Bottom" },
        { number: 7, title: "Top" },
      ],
      index: 2,
    };
    expect(parsePullStack({ stack: chain })).toEqual({
      ok: true,
      value: chain,
    });
    const fork = {
      parent: { number: 6, title: "Bottom" },
      children: [
        { number: 8, title: "Left" },
        { number: 9, title: "Right" },
      ],
    };
    expect(parsePullStack({ stack: fork })).toEqual({ ok: true, value: fork });
    expect(parsePullStack({ stack: { children: fork.children } })).toEqual({
      ok: true,
      value: { children: fork.children },
    });
  });

  it("refuses a malformed member or a missing index", () => {
    expect(
      parsePullStack({
        stack: { members: [{ number: "6", title: "x" }], index: 1 },
      }).ok,
    ).toBe(false);
    expect(
      parsePullStack({ stack: { members: [{ number: 6, title: "x" }] } }).ok,
    ).toBe(false);
    expect(parsePullStack({ stack: "nope" }).ok).toBe(false);
    expect(parsePullStack([]).ok).toBe(false);
  });
});
