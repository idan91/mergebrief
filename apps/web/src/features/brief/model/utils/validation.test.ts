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

const generation = { provider: "anthropic", model: "m", effort: "high" };

const group = {
  id: "g1",
  title: "Typesafe open/closed state",
  summary: "Adds typed state constants and threads state through contexts.",
  dominantCategory: "logic-refactor",
  secondaryCategories: [],
  uncertain: false,
  uncertainBetween: [],
};

const chunk = {
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

const briefBody = {
  pr,
  summary: "Adds accordion and collapsible components.",
  changeGroups: [group],
  chunks: [chunk],
  concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
};

const intentItem = {
  intent: "add the endpoint",
  quote: "Add a widget endpoint",
  sourceUrl: "https://tracker.example/T-1",
  groupIds: ["g1"],
  acknowledged: false,
};

const intentCheck = {
  ticketUrls: ["https://tracker.example/T-1"],
  specificity: "precise",
  scopeNote: "",
  accomplished: [intentItem],
  statedButMissing: [],
  doneButUnstated: [],
  deviations: [],
  maskedFixes: [],
};

function readBrief(body: object, warnings?: ParseWarnings) {
  const parsed = parseBrief(JSON.stringify(body), warnings);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

function stubSink() {
  const warn = vi.fn<ParseWarnings["warn"]>();
  return { sink: { warn }, warn };
}

describe("parseBrief", () => {
  it("reshapes a stored body into the full Brief view", () => {
    const brief = readBrief({ ...briefBody, anchoring: {} });

    expect(brief.artifactKind).toBe("brief");
    expect(brief.chunks[0]?.changeGroupId).toBe("g1");
    expect("anchoring" in brief).toBe(false);
  });

  it("fails with codes and paths only, never the issue message", () => {
    const parsed = parseBrief(JSON.stringify({ ...briefBody, summary: 42 }));

    expect(parsed).toEqual({ ok: false, error: "invalid:summary" });
  });

  it("fails on a body that is not JSON", () => {
    expect(parseBrief("{")).toEqual({ ok: false, error: "not-json:" });
  });

  it("warns each repair with its code and path as the only fields", () => {
    const { sink, warn } = stubSink();
    readBrief(
      {
        ...briefBody,
        readingOrder: "not an array",
        chunks: [{ ...chunk, changeGroupId: "gone" }],
      },
      sink,
    );

    const fields = warn.mock.calls.map((call) => call[1]);
    expect(fields).toEqual([
      { code: "dropped-section", path: "readingOrder" },
      { code: "unknown-change-group", path: "chunks.0.changeGroupId" },
    ]);
  });

  it("reads a repaired body silently when no sink is injected", () => {
    const brief = readBrief({ ...briefBody, readingOrder: "not an array" });

    expect(brief.readingOrder).toBeUndefined();
  });
});

describe("parseBrief intent check view", () => {
  it("pairs exactly one ticket title with each ticket URL", () => {
    const brief = readBrief({
      ...briefBody,
      intentCheck: { ...intentCheck, ticketTitles: ["Widget", "stray"] },
    });

    expect(brief.intentCheck?.ticketTitles).toEqual(["Widget"]);
  });

  it("fills an absent ticket title with an empty string", () => {
    const brief = readBrief({ ...briefBody, intentCheck });

    expect(brief.intentCheck?.ticketTitles).toEqual([""]);
  });

  it("keeps acknowledged only on the deviations bucket", () => {
    const acknowledged = { ...intentItem, acknowledged: true };
    const brief = readBrief({
      ...briefBody,
      intentCheck: {
        ...intentCheck,
        accomplished: [acknowledged],
        statedButMissing: [{ ...acknowledged, groupIds: [] }],
        doneButUnstated: [{ ...acknowledged, quote: "", sourceUrl: "" }],
        deviations: [acknowledged],
        maskedFixes: [acknowledged],
      },
    });

    const check = brief.intentCheck;
    expect(check?.deviations[0]?.acknowledged).toBe(true);
    expect(check?.accomplished[0]?.acknowledged).toBe(false);
    expect(check?.statedButMissing[0]?.acknowledged).toBe(false);
    expect(check?.doneButUnstated[0]?.acknowledged).toBe(false);
    expect(check?.maskedFixes[0]?.acknowledged).toBe(false);
  });
});

describe("parseBrief remainder guard", () => {
  function readRemainder(
    addedRanges: { start: number; end: number }[],
    warnings?: ParseWarnings,
  ) {
    const unattributed = [{ file: "src/x.ts", addedRanges, removedRanges: [] }];
    return readBrief({ ...briefBody, unattributed }, warnings);
  }

  it("keeps a canonical remainder and leaves an absent one absent", () => {
    const ranges = [{ start: 3, end: 5 }];

    expect(readRemainder(ranges).unattributed?.[0]?.addedRanges).toEqual(
      ranges,
    );
    expect("unattributed" in readBrief(briefBody)).toBe(false);
  });

  it("drops the remainder with a warning on an inverted range", () => {
    const { sink, warn } = stubSink();
    const brief = readRemainder([{ start: 5, end: 3 }], sink);

    expect("unattributed" in brief).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      path: "unattributed",
    });
  });

  it("drops the remainder on overlapping or unordered ranges", () => {
    const ranges = [
      { start: 1, end: 5 },
      { start: 4, end: 8 },
    ];

    expect("unattributed" in readRemainder(ranges)).toBe(false);
  });

  it("drops the remainder on a zero start", () => {
    const brief = readRemainder([{ start: 0, end: 2 }]);

    expect("unattributed" in brief).toBe(false);
  });
});

describe("parseDeltaBrief", () => {
  const deltaBody = {
    pr,
    baselineSha: "3578807971c2ddc8dc76a978f25f61e09f524941",
    headSha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
    baselineIndex: 1,
    headIndex: 2,
    generation,
    summary: "Since you last looked, typed state constants were added.",
    commentsAddressed: "Addresses prior comments about literal state strings.",
    changedGroups: [group],
    chunks: [
      { ...chunk, summary: "Adds AccordionStates.", addressesComments: ["7"] },
      {
        ...chunk,
        id: "c2",
        summary: "Updates data-state.",
        addressesComments: [],
      },
    ],
    wholePrImpact: "The follow-up tightens the original component API.",
  };

  it("reshapes a delta into the view with a derived concern view", () => {
    const parsed = parseDeltaBrief(JSON.stringify(deltaBody));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.artifactKind).toBe("delta");
    expect(parsed.value.changeGroups).toEqual([group]);
    expect(parsed.value.concernView).toEqual([
      { concern: "implementation", added: 14, deleted: 0 },
    ]);
    expect(parsed.value.chunks[0]?.summary).toBe("Adds AccordionStates.");
  });

  it("refuses a chunk naming no changed group", () => {
    const stray = { ...deltaBody.chunks[1], changeGroupId: "g9" };
    const body = { ...deltaBody, chunks: [deltaBody.chunks[0], stray] };

    expect(parseDeltaBrief(JSON.stringify(body))).toEqual({
      ok: false,
      error: "unknown-change-group:chunks.1.changeGroupId",
    });
  });
});

describe("parseRevisionNarrativeArtifact", () => {
  const narrativeBody = {
    artifactKind: "revisionNarrative",
    pr,
    prevHeadSha: "aaa",
    headSha: "bbb",
    prevIndex: 1,
    headIndex: 2,
    generation,
    overview: "Tightened the state constants.",
    chunks: [],
  };

  it("warns each repair and keeps the narrative", () => {
    const { sink, warn } = stubSink();
    const body = { ...narrativeBody, generationWarnings: [1] };
    const parsed = parseRevisionNarrativeArtifact(JSON.stringify(body), sink);

    expect(parsed.ok && parsed.value.artifactKind).toBe("revisionNarrative");
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      code: "dropped-section",
      path: "generationWarnings",
    });
  });
});
