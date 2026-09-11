import { describe, expect, it, vi } from "vitest";

import {
  parseBrief,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
  type ParseWarnings,
} from "./validation";

const pr = {
  repo: "Idan91/components",
  number: 4,
  title: "feat: Add Accordion And Collapsible Components",
  url: "https://github.com/Idan91/components/pull/4",
  sha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
  description: "Adds accordion and collapsible components.",
};

const newShapeGroup = {
  id: "g1",
  title: "Typesafe open/closed state",
  summary: "Adds typed state constants and threads state through contexts.",
  dominantCategory: "logic-refactor",
  secondaryCategories: [],
  uncertain: false,
  uncertainBetween: [],
};

const newShapeChunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "src/components/Accordion/Accordion.types.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 7, deleted: 0 },
  addedRanges: [{ start: 9, end: 12 }],
  removedRanges: [],
  riskSurface: ["cross-service"],
};

describe("parseBrief", () => {
  it("accepts categorizer output with group ids and chunk membership", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.changeGroups[0]?.id).toBe("g1");
    expect(parsed.value.chunks[0]?.changeGroupId).toBe("g1");
  });

  it("carries generationWarnings through, dropping non-string entries", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
      generationWarnings: ["⚠ salvaged brief: dropped 1 entry", 42, null],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.generationWarnings).toEqual([
      "⚠ salvaged brief: dropped 1 entry",
    ]);
  });

  it("omits generationWarnings when absent or empty", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
      generationWarnings: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("generationWarnings" in parsed.value).toBe(false);
  });
  it("carries lengthViolations through, dropping malformed entries", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
      lengthViolations: [
        {
          surface: "group-summary",
          field: "group g1 summary",
          actual: 300,
          cap: 250,
        },
        { surface: "group-title", field: "group g1 title" }, // missing numbers
        "not an object",
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lengthViolations).toEqual([
      {
        surface: "group-summary",
        field: "group g1 summary",
        actual: 300,
        cap: 250,
      },
    ]);
  });

  it("omits lengthViolations when absent, empty, or fully malformed", () => {
    const base = {
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    };
    for (const variant of [
      base, // absent
      { ...base, lengthViolations: [] }, // empty
      { ...base, lengthViolations: ["junk"] }, // fully malformed
    ]) {
      const parsed = parseBrief(variant);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect("lengthViolations" in parsed.value).toBe(false);
    }
  });

  it("carries the anchor stamp through and drops a malformed one", () => {
    const restart = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
      anchor: { state: "fresh-restart", reason: "model-swap" },
    });
    expect(restart.ok).toBe(true);
    if (!restart.ok) return;
    expect(restart.value.anchor).toEqual({
      state: "fresh-restart",
      reason: "model-swap",
    });

    const anchored = parseBrief({
      pr,
      summary: "s",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [],
      anchor: { state: "anchored" },
    });
    expect(anchored.ok && anchored.value.anchor).toEqual({
      state: "anchored",
    });

    const malformed = parseBrief({
      pr,
      summary: "s",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [],
      anchor: { state: 42 },
    });
    expect(malformed.ok).toBe(true);
    if (!malformed.ok) return;
    expect("anchor" in malformed.value).toBe(false);

    const absent = parseBrief({
      pr,
      summary: "s",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [],
    });
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect("anchor" in absent.value).toBe(false);
  });

  it("carries the pr lifecycle snapshot through", () => {
    const parsed = parseBrief({
      pr: { ...pr, state: "closed", draft: false, merged: true },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pr.state).toBe("closed");
    expect(parsed.value.pr.draft).toBe(false);
    expect(parsed.value.pr.merged).toBe(true);
  });

  it("omits the lifecycle fields on pre-stamping artifacts", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("state" in parsed.value.pr).toBe(false);
    expect("draft" in parsed.value.pr).toBe(false);
    expect("merged" in parsed.value.pr).toBe(false);
  });

  it("drops malformed lifecycle values instead of failing the artifact", () => {
    const parsed = parseBrief({
      pr: { ...pr, state: "MERGED", draft: "yes", merged: 1 },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("state" in parsed.value.pr).toBe(false);
    expect("draft" in parsed.value.pr).toBe(false);
    expect("merged" in parsed.value.pr).toBe(false);
  });

  it("carries headRef and baseRef through when they are strings", () => {
    const parsed = parseBrief({
      pr: { ...pr, headRef: "feature/thing", baseRef: "main" },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pr.headRef).toBe("feature/thing");
    expect(parsed.value.pr.baseRef).toBe("main");
  });

  it("drops malformed branch refs instead of failing the artifact", () => {
    const parsed = parseBrief({
      pr: { ...pr, headRef: 1, baseRef: { name: "main" } },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("headRef" in parsed.value.pr).toBe(false);
    expect("baseRef" in parsed.value.pr).toBe(false);
  });

  it("carries a linear stack through when members and index are valid", () => {
    const stack = {
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
      ],
      index: 2,
    };
    const parsed = parseBrief({
      pr: { ...pr, stack },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pr.stack).toEqual(stack);
  });

  it("drops a malformed stack and still keeps branch refs", () => {
    const parsed = parseBrief({
      pr: {
        ...pr,
        headRef: "feature/thing",
        baseRef: "main",
        stack: { index: "two" },
      },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pr.headRef).toBe("feature/thing");
    expect(parsed.value.pr.baseRef).toBe("main");
    expect("stack" in parsed.value.pr).toBe(false);
  });

  it("rejects pr urls that are not http or https", () => {
    const parsed = parseBrief({
      pr: { ...pr, url: "javascript:alert(1)" },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed).toEqual({
      ok: false,
      error:
        "Expected pr repo, number, title, http(s) url, sha, and description",
    });
  });

  it("normalizes legacy group chunk-id arrays to chunk membership", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [
        {
          ...newShapeGroup,
          id: undefined,
          coreChunkIds: ["c1"],
          supportingChunkIds: [],
        },
      ],
      chunks: [{ ...newShapeChunk, changeGroupId: undefined }],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.changeGroups[0]?.id).toBe("g1");
    expect(parsed.value.chunks[0]?.changeGroupId).toBe("g1");
  });

  const secondGroup = {
    ...newShapeGroup,
    id: "g2",
    title: "Second group",
  };
  const secondChunk = {
    ...newShapeChunk,
    id: "c2",
    changeGroupId: "g2",
  };
  const twoGroupBriefInput = {
    pr,
    summary: "Adds accordion and collapsible components.",
    changeGroups: [newShapeGroup, secondGroup],
    chunks: [newShapeChunk, secondChunk],
    concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
  };

  it("keeps a readingOrder that is a valid permutation of group ids", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      readingOrder: [
        { groupId: "g2", why: "establishes the schema the rest builds on" },
        { groupId: "g1", why: "wires the schema into call sites" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toEqual([
      { groupId: "g2", why: "establishes the schema the rest builds on" },
      { groupId: "g1", why: "wires the schema into call sites" },
    ]);
  });

  it("drops a readingOrder missing a group and keeps the Brief", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      readingOrder: [
        { groupId: "g1", why: "wires the schema into call sites" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
  });

  it("drops a readingOrder with an unknown group id", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      readingOrder: [
        { groupId: "g1", why: "wires the schema into call sites" },
        { groupId: "g-stale", why: "leftover from a prior regeneration" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
  });

  it("drops a readingOrder with a duplicated group id", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      readingOrder: [
        { groupId: "g1", why: "wires the schema into call sites" },
        { groupId: "g1", why: "duplicate" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
  });

  it("drops a malformed readingOrder step and keeps the Brief", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      readingOrder: [{ groupId: "g1" }, { groupId: "g2", why: "next" }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
  });

  it("omits readingOrder from the parsed value when the field is absent", () => {
    const parsed = parseBrief(twoGroupBriefInput);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
  });

  const preciseIntentCheck = {
    ticketUrls: ["https://tracker.example/T-1"],
    specificity: "precise",
    scopeNote: "",
    accomplished: [
      {
        intent: "add the endpoint",
        quote: "Add a widget endpoint",
        sourceUrl: "https://tracker.example/T-1",
        groupIds: ["g1"],
      },
    ],
    statedButMissing: [
      {
        intent: "document it",
        quote: "and document it",
        sourceUrl: "https://tracker.example/T-1",
        groupIds: [],
      },
    ],
    doneButUnstated: [
      { intent: "lint fix", quote: "", sourceUrl: "", groupIds: ["g2"] },
    ],
  };

  it("keeps a well-formed alignment and drops a malformed one", () => {
    const alignment = {
      read: "partial",
      goal: "Add a copy button",
      response: "Adds the button; no docs.",
    };
    const kept = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: { ...preciseIntentCheck, alignment },
    });
    expect(kept.ok && kept.value.intentCheck?.alignment).toEqual(alignment);

    const warnSink: ParseWarnings = { warn: vi.fn() };
    const dropped = parseBrief(
      {
        ...twoGroupBriefInput,
        intentCheck: {
          ...preciseIntentCheck,
          alignment: { ...alignment, read: "great" },
        },
      },
      warnSink,
    );
    expect(dropped.ok && dropped.value.intentCheck?.alignment).toBeUndefined();
    expect(dropped.ok && dropped.value.intentCheck?.specificity).toBe(
      "precise",
    );
    expect(warnSink.warn).toHaveBeenCalledWith(
      expect.stringContaining("dropping alignment"),
    );
  });

  it("keeps a well-formed primaryTicket on the intentCheck", () => {
    const primaryTicket = {
      key: "DS-42",
      url: "https://tasks.example/DS-42",
      tracker: "notion",
      foundIn: "description",
      title: "Retry loop",
      header: "Status: Now",
      status: "read",
      reason: "",
    };
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: { ...preciseIntentCheck, primaryTicket },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.primaryTicket).toEqual(primaryTicket);
  });

  it.each([
    ["not an object", "DS-42"],
    [
      "an unknown tracker",
      {
        key: "",
        url: "u",
        tracker: "jira",
        foundIn: "title",
        title: "",
        header: "",
        status: "read",
        reason: "",
      },
    ],
    [
      "an unknown reason",
      {
        key: "",
        url: "u",
        tracker: "github",
        foundIn: "title",
        title: "",
        header: "",
        status: "unread",
        reason: "exploded",
      },
    ],
    [
      "a missing field",
      {
        key: "",
        url: "u",
        tracker: "github",
        foundIn: "title",
        status: "read",
        reason: "",
      },
    ],
  ])(
    "drops a malformed primaryTicket %s and keeps the intentCheck",
    (_label, primaryTicket) => {
      const warnings: ParseWarnings = { warn: vi.fn() };
      const parsed = parseBrief(
        {
          ...twoGroupBriefInput,
          intentCheck: { ...preciseIntentCheck, primaryTicket },
        },
        warnings,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.intentCheck?.specificity).toBe("precise");
      expect(parsed.value.intentCheck?.primaryTicket).toBeUndefined();
      expect(warnings.warn).toHaveBeenCalledWith(
        expect.stringContaining("dropping primaryTicket"),
      );
    },
  );

  it("keeps a well-formed intentCheck on a full Brief", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: preciseIntentCheck,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.specificity).toBe("precise");
    expect(parsed.value.intentCheck?.accomplished[0]?.groupIds).toEqual(["g1"]);
    expect(parsed.value.intentCheck?.doneButUnstated[0]?.sourceUrl).toBe("");
  });

  it("keeps a broad/none intentCheck with empty buckets", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ticketUrls: [],
        specificity: "broad",
        scopeNote: "parent epic",
        accomplished: [],
        statedButMissing: [],
        doneButUnstated: [],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.specificity).toBe("broad");
  });

  // Back-compat: `preciseIntentCheck` above is deliberately an older shape ,
  // no alarm arrays, no `acknowledged` on its items. Every one of these
  // asserts that such a Brief keeps working.
  it("defaults the alarm buckets to empty on an older intentCheck", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: preciseIntentCheck,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Absent arrays must NOT drop the whole check - the bar still renders.
    expect(parsed.value.intentCheck?.deviations).toEqual([]);
    expect(parsed.value.intentCheck?.claimedButUnachieved).toEqual([]);
  });

  it("defaults ticketTitles to empty strings on an older intentCheck", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: preciseIntentCheck,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // One "" per URL - the renderer's id-only fallback, never a dropped check.
    expect(parsed.value.intentCheck?.ticketTitles).toEqual([""]);
  });

  it("keeps ticketTitles paired with ticketUrls after a length mismatch", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ...preciseIntentCheck,
        ticketTitles: ["Widget endpoint", "stray extra"],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.ticketTitles).toEqual(["Widget endpoint"]);
  });

  it("drops the intentCheck when a PRESENT ticketTitles is malformed", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: { ...preciseIntentCheck, ticketTitles: [42] },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("reads a missing `acknowledged` as false on every older item", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: preciseIntentCheck,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.accomplished[0]?.acknowledged).toBe(false);
    expect(parsed.value.intentCheck?.statedButMissing[0]?.acknowledged).toBe(
      false,
    );
  });

  it("keeps acknowledged true on a deviation as a quiet receipt", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ...preciseIntentCheck,
        deviations: [
          {
            intent: "drops the cache",
            quote: "keep the widget cache",
            sourceUrl: "https://tracker.example/T-1",
            groupIds: ["g1"],
            acknowledged: true,
          },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck?.deviations[0]?.acknowledged).toBe(true);
  });

  it("reads a non-boolean acknowledged as false instead of dropping", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ...preciseIntentCheck,
        deviations: [
          {
            intent: "drops the cache",
            quote: "keep the widget cache",
            sourceUrl: "https://tracker.example/T-1",
            groupIds: ["g1"],
            acknowledged: "yes",
          },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Only `true` is critical; anything else is safely the alarm register.
    expect(parsed.value.intentCheck?.deviations[0]?.acknowledged).toBe(false);
  });

  it("re-sweeps acknowledged off the four non-deviation buckets", () => {
    // Generation forces this, but the file-backed demo path parses arbitrary
    // local JSON - so the read path re-sweeps rather than trusting it.
    const ackEverywhere = {
      intent: "x",
      quote: "keep the widget cache",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: true,
    };
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ...preciseIntentCheck,
        accomplished: [ackEverywhere],
        statedButMissing: [{ ...ackEverywhere, groupIds: [] }],
        doneButUnstated: [{ ...ackEverywhere, quote: "", sourceUrl: "" }],
        deviations: [ackEverywhere],
        claimedButUnachieved: [ackEverywhere],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const check = parsed.value.intentCheck;
    // Only `deviations` keeps it.
    expect(check?.deviations[0]?.acknowledged).toBe(true);
    expect(check?.accomplished[0]?.acknowledged).toBe(false);
    expect(check?.statedButMissing[0]?.acknowledged).toBe(false);
    expect(check?.doneButUnstated[0]?.acknowledged).toBe(false);
    expect(check?.claimedButUnachieved[0]?.acknowledged).toBe(false);
  });

  it("still drops the check when a PRESENT alarm array is malformed", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: { ...preciseIntentCheck, claimedButUnachieved: "nope" },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Absent is lenient; present-but-wrong is not - same posture as the four
    // required buckets.
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("drops a malformed intentCheck and keeps the Brief valid", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: { ...preciseIntentCheck, specificity: "vague" },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("drops an intentCheck whose bucket item is missing groupIds", () => {
    const parsed = parseBrief({
      ...twoGroupBriefInput,
      intentCheck: {
        ...preciseIntentCheck,
        accomplished: [{ intent: "x", quote: "y", sourceUrl: "" }],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("omits intentCheck when the field is absent on a pre-feature Brief", () => {
    const parsed = parseBrief(twoGroupBriefInput);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("never carries intentCheck onto a Delta Brief", () => {
    const parsed = parseDeltaBrief({
      pr,
      baselineSha: "1111111",
      headSha: "2222222",
      summary: "since you last looked",
      commentsAddressed: "",
      changedGroups: [newShapeGroup],
      chunks: [
        { ...newShapeChunk, summary: "adds a test", addressesComments: [] },
      ],
      wholePrImpact: "completes the intent",
      intentCheck: preciseIntentCheck,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intentCheck).toBeUndefined();
  });

  it("reports every warn-and-drop through the injected sink", () => {
    const warn = vi.fn<ParseWarnings["warn"]>(() => {});
    const parsed = parseBrief(
      {
        ...twoGroupBriefInput,
        readingOrder: "not an array",
        intentCheck: { ...preciseIntentCheck, specificity: "vague" },
      },
      { warn },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.readingOrder).toBeUndefined();
    expect(parsed.value.intentCheck).toBeUndefined();
    const messages = warn.mock.calls.map(([msg]) => msg);
    expect(messages).toHaveLength(2);
    expect(
      messages.every((msg) => msg.startsWith("parseBrief: dropping")),
    ).toBe(true);
  });

  it("stays silent when the caller injects no sink", () => {
    // No sink and no console noise - the BROWSER contract only. Coverage is
    // per call site: a caller that passes nothing on the server gets NO
    // signal, so passing a sink is the caller's job.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = parseBrief({
        ...twoGroupBriefInput,
        readingOrder: "not an array",
      });
      expect(parsed.ok).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("parseRevisionNarrativeArtifact reason narrowing", () => {
  it("narrows the skip reason without a cast", () => {
    // `isOneOf` is a type predicate, so the parsed stub's `skipped` is already
    // the union - this asserts the value survives the guard unchanged.
    const parsed = parseRevisionNarrativeArtifact({
      artifactKind: "revisionNarrativeSkipped",
      pr,
      prevHeadSha: "a".repeat(40),
      headSha: "b".repeat(40),
      prevIndex: 1,
      headIndex: 2,
      skipped: "span too large",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ skipped: "span too large" });
  });
});

describe("parseRevisionNarrativeArtifact", () => {
  const narrativeWire = {
    artifactKind: "revisionNarrative",
    pr,
    prevHeadSha: "prev1234",
    headSha: "head1234",
    prevIndex: 1,
    headIndex: 2,
    generation: { provider: "anthropic", model: "m", effort: null },
    overview: "o",
    chunks: [],
  };

  it("carries generationWarnings through, dropping non-string entries", () => {
    const parsed = parseRevisionNarrativeArtifact({
      ...narrativeWire,
      generationWarnings: ["⚠ revision narrative coverage issues: …", 7],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    if (parsed.value.artifactKind !== "revisionNarrative") {
      throw new Error("expected a narrative");
    }
    expect(parsed.value.generationWarnings).toEqual([
      "⚠ revision narrative coverage issues: …",
    ]);
  });

  it("omits generationWarnings when absent", () => {
    const parsed = parseRevisionNarrativeArtifact(narrativeWire);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("generationWarnings" in parsed.value).toBe(false);
  });
});

describe("parseDeltaBrief", () => {
  it("normalizes delta output into a renderable local artifact", () => {
    const parsed = parseDeltaBrief({
      pr,
      baselineSha: "3578807971c2ddc8dc76a978f25f61e09f524941",
      headSha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
      summary: "Since you last looked, typed state constants were added.",
      commentsAddressed:
        "Addresses prior comments about literal state strings.",
      reviewComments: [
        {
          id: "3419186366",
          file: "src/components/Accordion/Accordion.tsx",
          startLine: 40,
          line: 42,
          originalStartLine: 38,
          originalLine: 40,
          author: "Idan91",
          body: "Can we avoid literal state strings here?",
          inReplyToId: null,
          outdated: false,
        },
      ],
      changedGroups: [newShapeGroup],
      chunks: [
        {
          ...newShapeChunk,
          summary: "Adds AccordionStates and context state.",
          addressesComments: ["3419186366"],
        },
        {
          ...newShapeChunk,
          id: "c2",
          summary: "Updates data-state usage in the component.",
          addressesComments: [],
        },
      ],
      wholePrImpact: "The follow-up tightens the original component API.",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.artifactKind).toBe("delta");
    expect(parsed.value.baselineSha?.slice(0, 8)).toBe("35788079");
    expect(parsed.value.concernView).toEqual([
      { concern: "implementation", added: 14, deleted: 0 },
    ]);
    expect(parsed.value.chunks[0]?.summary).toBe(
      "Adds AccordionStates and context state.",
    );
    expect(parsed.value.chunks[1]?.addressesComments).toEqual([]);
    expect(parsed.value.reviewComments?.[0]?.body).toBe(
      "Can we avoid literal state strings here?",
    );
    expect(parsed.value.reviewComments?.[0]?.startLine).toBe(40);
    expect(parsed.value.reviewComments?.[0]?.originalStartLine).toBe(38);
  });
});

function briefWith(riskSurface: unknown) {
  return {
    pr: {
      repo: "o/r",
      number: 1,
      title: "t",
      url: "https://github.com/o/r/pull/1",
      sha: "deadbeef",
      description: "d",
    },
    summary: "s",
    changeGroups: [
      {
        id: "g1",
        title: "t",
        summary: "s",
        dominantCategory: "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "a.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 1, deleted: 0 },
        addedRanges: [],
        removedRanges: [],
        riskSurface,
      },
    ],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  };
}

describe("risk tokens accept a widened vocabulary", () => {
  it("accepts a repo-defined kebab-case token alongside built-ins", () => {
    expect(parseBrief(briefWith(["touches-auth", "touches-billing"])).ok).toBe(
      true,
    );
  });

  it.each([
    ["whitespace", ["has space"]],
    ["uppercase", ["Bad-Case"]],
    ["empty", [""]],
    ["oversized", ["x".repeat(51)]],
  ])("rejects a %s token", (_label, riskSurface) => {
    expect(parseBrief(briefWith(riskSurface)).ok).toBe(false);
  });
});

describe("parseBrief unattributed", () => {
  const base = {
    pr,
    summary: "s",
    changeGroups: [newShapeGroup],
    chunks: [newShapeChunk],
    concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
  };

  it("carries the unattributed per-file ranges through", () => {
    const parsed = parseBrief({
      ...base,
      unattributed: [
        {
          file: "src/extra.ts",
          addedRanges: [{ start: 3, end: 5 }],
          removedRanges: [],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.unattributed).toEqual([
      {
        file: "src/extra.ts",
        addedRanges: [{ start: 3, end: 5 }],
        removedRanges: [],
      },
    ]);
  });

  it("keeps an empty unattributed array distinct from absent", () => {
    const withEmpty = parseBrief({ ...base, unattributed: [] });
    expect(withEmpty.ok).toBe(true);
    if (!withEmpty.ok) return;
    expect(withEmpty.value.unattributed).toEqual([]);

    const absent = parseBrief(base);
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect("unattributed" in absent.value).toBe(false);
  });

  it("drops a malformed unattributed field with a warning, keeping the brief", () => {
    const warnings: string[] = [];
    const parsed = parseBrief(
      { ...base, unattributed: [{ file: 42 }] },
      { warn: (msg) => warnings.push(msg) },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("unattributed" in parsed.value).toBe(false);
    expect(warnings.some((w) => w.includes("unattributed"))).toBe(true);
  });
});

describe("parseBrief unattributed canonical-range guard", () => {
  const base = {
    pr,
    summary: "s",
    changeGroups: [newShapeGroup],
    chunks: [newShapeChunk],
    concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
  };

  it("drops the field with a warning on an inverted range", () => {
    const warnings: string[] = [];
    const parsed = parseBrief(
      {
        ...base,
        unattributed: [
          {
            file: "src/x.ts",
            addedRanges: [{ start: 5, end: 3 }],
            removedRanges: [],
          },
        ],
      },
      { warn: (msg) => warnings.push(msg) },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("unattributed" in parsed.value).toBe(false);
    expect(warnings.some((w) => w.includes("unattributed"))).toBe(true);
  });

  it("drops the field on overlapping or unordered ranges", () => {
    const warnings: string[] = [];
    const parsed = parseBrief(
      {
        ...base,
        unattributed: [
          {
            file: "src/x.ts",
            addedRanges: [
              { start: 1, end: 5 },
              { start: 4, end: 8 },
            ],
            removedRanges: [],
          },
        ],
      },
      { warn: (msg) => warnings.push(msg) },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("unattributed" in parsed.value).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("drops the field on a zero or negative start", () => {
    const parsed = parseBrief(
      {
        ...base,
        unattributed: [
          {
            file: "src/x.ts",
            addedRanges: [{ start: 0, end: 2 }],
            removedRanges: [],
          },
        ],
      },
      { warn: () => {} },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("unattributed" in parsed.value).toBe(false);
  });
});

describe("parseBrief diffTotals", () => {
  const base = {
    pr,
    summary: "s",
    changeGroups: [newShapeGroup],
    chunks: [newShapeChunk],
    concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
  };

  it("carries valid totals and drops malformed ones", () => {
    const good = parseBrief({ ...base, diffTotals: { added: 9, deleted: 2 } });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.diffTotals).toEqual({ added: 9, deleted: 2 });

    const bad = parseBrief({ ...base, diffTotals: { added: "9" } });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect("diffTotals" in bad.value).toBe(false);
  });
});
