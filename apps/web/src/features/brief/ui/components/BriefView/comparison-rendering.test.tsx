// @vitest-environment jsdom
import type { RevisionNarrative } from "brief-core/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";
import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
} from "@web/features/review/session";

import {
  buildChunkComparisonView,
  type ComparisonSource,
} from "../../../model/comparison/runs";
import type { ComparisonQuery } from "../../../model/comparison/comparison-query";
import type { Brief, BriefChunk, ComparisonMarks } from "../../../model/types";
import { buildBriefViewModel } from "../../../model/utils/view-model";
import { ChangesOnlyView } from "./ChangesOnlyView";
import { ComparisonCallout } from "./DiffTable/ComparisonCallout";
import { ReviewPostureProvider } from "../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../utils/review-posture";

const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "t",
  url: "https://example.com/pr/7",
  sha: "head1234",
  description: "",
};

const chunkA: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 11, end: 11 }],
  removedRanges: [],
  riskSurface: [],
  summary: "Core chunk.",
  diff: [
    { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
    { kind: "ctx", content: "const a = 1;", oldLine: 10, newLine: 10 },
    { kind: "add", content: "validate(a);", newLine: 11 },
  ],
};

const fullBrief: Brief = {
  artifactKind: "brief",
  pr: PR,
  summary: "Full brief summary.",
  index: 3,
  changeGroups: [
    {
      id: "g1",
      title: "Tighten validation",
      summary: "Adds a validation guard.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunkA],
  concernView: [],
};

const previousBriefMarks: ComparisonMarks = {
  baselineSha: "prev1234",
  headSha: "head1234",
  baselineLabel: "previous-brief",
  baselineIndex: 2,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
    },
  ],
};

const checkpointMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: "head1234",
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
    },
  ],
};

const narrative: RevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: PR,
  prevHeadSha: "prev1234",
  headSha: "head1234",
  prevIndex: 2,
  headIndex: 3,
  generation: { provider: "anthropic", model: "m", effort: null },
  overview: "This revision adds a validation guard.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
      summary: "Adds the validate(a) guard on the shared path.",
    },
  ],
};

const delta: Brief = {
  artifactKind: "delta",
  pr: PR,
  summary: "Delta since your checkpoint.",
  baselineSha: "chk1234",
  headSha: "head1234",
  changeGroups: [
    {
      id: "dg1",
      title: "Guarded shared path",
      summary: "Adds validation since you last looked.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "dchunk-a",
      changeGroupId: "dg1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [],
      riskSurface: [],
      summary: "Delta chunk: adds the guard.",
      diff: [{ kind: "add", content: "validate(a);", newLine: 11 }],
    },
  ],
  concernView: [],
};

describe("Full Brief comparison overlay", () => {
  it("Previous Brief uses previous-brief marks, Revision narrative callouts", () => {
    // Highlights are mechanical, derived from the previous-brief marks only.
    const view = buildChunkComparisonView(chunkA, previousBriefMarks);
    const run = view.runs[0];
    expect(run).toBeDefined();
    expect(run?.kind).toBe("added");

    // The prominent text comes from the Revision narrative chunk; the owning
    // change-group renders as a de-emphasized "In:" origin line under it.
    const source: ComparisonSource = {
      kind: "previous-brief",
      brief: fullBrief,
      narrative,
    };
    render(
      <ComparisonCallout
        anchor={document.body}
        onClose={() => {}}
        run={run!}
        chunk={chunkA}
        source={source}
        skipReason={null}
      />,
    );
    expect(screen.getByText("New this revision")).toBeTruthy();
    expect(screen.getByText("In: Tighten validation")).toBeTruthy();
    const title = screen.getByText(
      "Adds the validate(a) guard on the shared path.",
    );
    // Display-side length guard: the span summary clamps at 4 lines, data
    // untouched, presentation only.
    expect(title.getAttribute("data-clamp")).toBe("");
    expect(title.style.webkitLineClamp).toBe("4");
  });

  it("shows a note and the chunk's group when the narrative misses the span", () => {
    const view = buildChunkComparisonView(chunkA, previousBriefMarks);
    const run = view.runs[0];
    expect(run).toBeDefined();

    const missing: RevisionNarrative = {
      ...narrative,
      chunks: [
        { ...narrative.chunks[0]!, addedRanges: [{ start: 90, end: 95 }] },
      ],
    };
    render(
      <ComparisonCallout
        anchor={document.body}
        onClose={() => {}}
        run={run!}
        chunk={chunkA}
        source={{
          kind: "previous-brief",
          brief: fullBrief,
          narrative: missing,
        }}
        skipReason={null}
      />,
    );
    // Degraded, not unavailable: chunk summary + owning group + the note.
    expect(screen.getByText("Core chunk.")).toBeTruthy();
    expect(screen.getByText("In: Tighten validation")).toBeTruthy();
    expect(
      screen.getByText("Span summary unavailable — showing group context."),
    ).toBeTruthy();
    expect(screen.queryByText("Summary unavailable for this span.")).toBeNull();
  });

  it("Your last review uses checkpoint marks and Delta callouts", () => {
    const view = buildChunkComparisonView(chunkA, checkpointMarks);
    const run = view.runs[0];
    expect(run).toBeDefined();

    const source: ComparisonSource = { kind: "last-review", delta };
    render(
      <ComparisonCallout
        anchor={document.body}
        onClose={() => {}}
        run={run!}
        chunk={chunkA}
        source={source}
        skipReason={null}
      />,
    );
    expect(screen.getByText("New since your last review")).toBeTruthy();
    expect(screen.getByText("In: Guarded shared path")).toBeTruthy();
    expect(screen.getByText("Delta chunk: adds the guard.")).toBeTruthy();
  });
});

describe("Changes Only rendering", () => {
  it("Previous Brief groups narrative chunks under full Brief groups", () => {
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(
      screen.getByText("This revision adds a validation guard."),
    ).toBeTruthy();
    // Header is the full Brief group's title/category, not a narrative taxonomy.
    const heading = screen.getByRole("heading", { name: "Tighten validation" });
    expect(heading).toBeTruthy();
    const group = heading.closest("section");
    expect(group?.textContent).toContain(
      "Adds the validate(a) guard on the shared path.",
    );
  });

  it("shows the muted fresh-restart line only on a fresh-restart brief", () => {
    const restarted: Brief = {
      ...fullBrief,
      anchor: { state: "fresh-restart", reason: "model-swap" },
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={restarted}
          model={buildBriefViewModel(restarted)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.getByText("Regenerated fresh — model change.")).toBeTruthy();
  });

  it("shows the fresh-restart line even when the narrative is unavailable", () => {
    const restarted: Brief = {
      ...fullBrief,
      anchor: { state: "fresh-restart", reason: "model-swap" },
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={restarted}
          model={buildBriefViewModel(restarted)}
          narrative={null}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.getByText("Regenerated fresh — model change.")).toBeTruthy();
    expect(screen.getByText(/Revision summary unavailable/)).toBeTruthy();
  });

  it("shows the fresh-restart line above the skip-reason empty state too", () => {
    const restarted: Brief = {
      ...fullBrief,
      anchor: { state: "fresh-restart", reason: "model-swap" },
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={restarted}
          model={buildBriefViewModel(restarted)}
          narrative={null}
          marks={previousBriefMarks}
          skipReason="span too large"
          delta={null}
        />,
      ),
    );
    expect(screen.getByText("Regenerated fresh — model change.")).toBeTruthy();
    expect(screen.getByText(/No revision summary/)).toBeTruthy();
  });

  it("shows the length-guidance line only when the brief stamps violations", () => {
    const verbose: Brief = {
      ...fullBrief,
      lengthViolations: [
        {
          surface: "group-summary",
          field: "group g1 summary",
          actual: 300,
          cap: 250,
        },
      ],
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={verbose}
          model={buildBriefViewModel(verbose)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(
      screen.getByText(/Some brief text exceeds length guidance/),
    ).toBeTruthy();
  });

  it("shows the length-guidance line for narrative-only violations", () => {
    const verboseNarrative: RevisionNarrative = {
      ...narrative,
      lengthViolations: [
        {
          surface: "narrative-overview",
          field: "narrative overview",
          actual: 300,
          cap: 250,
        },
      ],
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={verboseNarrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(
      screen.getByText(/Some brief text exceeds length guidance/),
    ).toBeTruthy();
  });

  it("shows the length-guidance line on a violating last-review delta", () => {
    const verboseDelta: Brief = {
      ...delta,
      lengthViolations: [
        {
          surface: "group-summary",
          field: "group g1 summary",
          actual: 300,
          cap: 250,
        },
      ],
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="last-review"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={null}
          marks={checkpointMarks}
          skipReason={null}
          delta={verboseDelta}
        />,
      ),
    );
    expect(
      screen.getByText(/Some brief text exceeds length guidance/),
    ).toBeTruthy();
  });

  it("hides the length-guidance line on a clean brief", () => {
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.queryByText(/exceeds length guidance/)).toBeNull();
  });

  it("hides the fresh-restart line on anchored and unstamped briefs", () => {
    const anchored: Brief = { ...fullBrief, anchor: { state: "anchored" } };
    const { unmount } = render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={anchored}
          model={buildBriefViewModel(anchored)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.queryByText(/Regenerated fresh/)).toBeNull();
    unmount();
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.queryByText(/Regenerated fresh/)).toBeNull();
  });

  it("keeps narrative generation warnings out of the reading path", () => {
    const warned: RevisionNarrative = {
      ...narrative,
      generationWarnings: ["narrative missed 2 changed spans"],
    };
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={warned}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.queryByText("narrative missed 2 changed spans")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("Your last review renders the Delta artifact under Changes Only copy", () => {
    render(
      withClient(
        <ChangesOnlyView
          compare="last-review"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={null}
          marks={null}
          skipReason={null}
          delta={delta}
        />,
      ),
    );
    expect(screen.getByText(/Changes since your last review/)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Guarded shared path" }),
    ).toBeTruthy();
    expect(screen.getByText("Delta chunk: adds the guard.")).toBeTruthy();
    // "Delta" is internal, never a primary visible label.
    expect(screen.queryByText("Delta brief")).toBeNull();
  });
});

const RAW_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,2 @@",
  " const a = 1;",
  "+validate(a);",
].join("\n");

function rawDiffQuery(base: string): ComparisonQuery<string> {
  return {
    queryKey: ["pr-diff", "424242", 7, base, "head1234"],
    queryFn: async (): Promise<string> => RAW_DIFF,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

/** Changes Only hosts guest tables, which read the session stores like Full. */
function withClient(node: ReactNode) {
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(fullBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <ReviewPostureProvider posture={makeReviewPosture()}>
            {node}
          </ReviewPostureProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>
  );
}

describe("Changes Only raw span diff toggle", () => {
  it("offers no toggle when no raw span diff descriptor is supplied", () => {
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
        />,
      ),
    );
    expect(screen.queryByRole("button", { name: /raw diff/i })).toBeNull();
  });

  it("offers the toggle when a comparison supplies the descriptor", () => {
    render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
          rawSpanDiff={rawDiffQuery("prev1234")}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Raw diff" })).toBeTruthy();
  });

  it("resets the toggle on a comparison switch even when both share the span", async () => {
    // checkpoint == previous head: both descriptors carry an identical
    // queryKey, so the span alone cannot distinguish the views: the comparison is
    // part of the remount key.
    const { rerender } = render(
      withClient(
        <ChangesOnlyView
          compare="previous-brief"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={narrative}
          marks={previousBriefMarks}
          skipReason={null}
          delta={null}
          rawSpanDiff={rawDiffQuery("prev1234")}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Raw diff" }));
    expect(
      screen
        .getByRole("button", { name: "Raw diff" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(
      withClient(
        <ChangesOnlyView
          compare="last-review"
          brief={fullBrief}
          model={buildBriefViewModel(fullBrief)}
          narrative={null}
          marks={null}
          skipReason={null}
          delta={delta}
          rawSpanDiff={rawDiffQuery("prev1234")}
        />,
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Raw diff" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
