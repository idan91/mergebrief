// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { Concerns, Roles, type RevisionNarrative } from "brief-core/types";
import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type ReviewSessionActions,
  useReviewSession,
  useReviewSessionActions,
} from "@web/features/review/session";
import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import { appI18n } from "../../../../../../i18n/I18nProvider";
import { type Brief, type BriefChunk } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { ApiError, ApiErrorCodes } from "@web/data/apiFetch";
import type { BriefComparisonPlan } from "../../../../model/comparison/types";
import type { ComparisonMarks } from "../../../../model/types";
import { useComparisonOverlay } from "../comparison/useComparisonOverlay";
import {
  type DeltaSpanLanding,
  type DeltaSpanStatus,
  DeltaSpanStatuses,
} from "../types";
import { ChangesOnlyView } from ".";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "t",
  url: "https://example.com/pr/7",
  sha: "head1234",
  description: "",
};

const FLAGGED: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: Concerns.IMPLEMENTATION,
  role: Roles.CORE,
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 11, end: 11 }],
  removedRanges: [],
  riskSurface: ["dense-logic"],
  summary: "Core chunk.",
  diff: [
    { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
    { kind: "ctx", content: "const a = 1;", oldLine: 10, newLine: 10 },
    { kind: "add", content: "validate(a);", newLine: 11 },
  ],
};

const ELSEWHERE: BriefChunk = {
  ...FLAGGED,
  id: "chunk-b",
  file: "src/b.ts",
  addedRanges: [{ start: 5, end: 5 }],
  diff: [{ kind: "add", content: "other();", newLine: 5 }],
};

/** A flagged chunk of another group, on a file the first group never touches. */
const OTHER_GROUP: BriefChunk = {
  ...FLAGGED,
  id: "chunk-c",
  changeGroupId: "g2",
  file: "src/c.ts",
  addedRanges: [{ start: 7, end: 7 }],
  diff: [{ kind: "add", content: "third();", newLine: 7 }],
};

const FULL_BRIEF: Brief = {
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
    {
      id: "g2",
      title: "Third path",
      summary: "Touches the third file.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [FLAGGED, ELSEWHERE, OTHER_GROUP],
  concernView: [],
};

const NARRATIVE: RevisionNarrative = {
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
    {
      id: "rc2",
      briefChangeGroupId: "g1",
      file: "src/c.ts",
      addedRanges: [{ start: 7, end: 7 }],
      removedRanges: [],
      summary: "Reaches into the third file from the first group.",
    },
  ],
};

const DELTA: Brief = {
  ...FULL_BRIEF,
  artifactKind: "delta",
  summary: "Delta since your checkpoint.",
  chunks: [
    {
      ...FLAGGED,
      id: "d1",
      riskSurface: [],
      summary: "Delta chunk on the guarded line.",
    },
  ],
};

/** A full brief whose secret sits on a file no change group claims. */
const REMAINDER_BRIEF: Brief = {
  ...FULL_BRIEF,
  unattributed: [
    {
      file: "src/key.ts",
      addedRanges: [{ start: 4, end: 4 }],
      removedRanges: [],
      riskSurface: ["adds-secret"],
    },
  ],
};

const REMAINDER_NARRATIVE: RevisionNarrative = {
  ...NARRATIVE,
  chunks: [
    ...NARRATIVE.chunks,
    {
      id: "rc3",
      briefChangeGroupId: "g1",
      file: "src/key.ts",
      addedRanges: [{ start: 4, end: 4 }],
      removedRanges: [],
      summary: "Adds a key to the config file.",
    },
  ],
};

interface RenderOptions {
  compare?: "previous-brief" | "last-review";
  brief?: Brief;
  narrative?: RevisionNarrative;
  deltaSpan?: DeltaSpanStatus;
  deltaSpanLanding?: DeltaSpanLanding;
  /** Drives the pane through the real comparison overlay instead. */
  plan?: BriefComparisonPlan;
}

interface ProbeProps {
  onActions: (actions: ReviewSessionActions) => void;
  onDispositions: (kinds: Record<string, string>) => void;
}

/** Reads the session store the group card reads, from inside the providers. */
function SessionProbe({ onActions, onDispositions }: ProbeProps) {
  const actions = useReviewSessionActions();
  const dispositions = useReviewSession((state) => state.dispositions);
  useEffect(() => {
    onActions(actions);
  }, [actions, onActions]);
  useEffect(() => {
    const kinds: Record<string, string> = {};
    for (const [id, disposition] of Object.entries(dispositions)) {
      kinds[id] = disposition.kind;
    }
    onDispositions(kinds);
  }, [dispositions, onDispositions]);
  return null;
}

interface OverlayChangesProps {
  brief: Brief;
  model: ReturnType<typeof buildBriefViewModel>;
  plan: BriefComparisonPlan;
  jumpToChunk: (chunkId: string) => void;
}

/** The last-review pane as the screen wires it, through the comparison overlay. */
function OverlayChanges({
  brief,
  model,
  plan,
  jumpToChunk,
}: OverlayChangesProps) {
  const overlay = useComparisonOverlay({
    brief,
    comparisonPlan: plan,
    searchParams: { view: "changes", compare: "last-review" },
  });

  return (
    <ChangesOnlyView
      brief={brief}
      compare="last-review"
      delta={overlay.delta}
      deltaSpan={overlay.deltaSpanStatus}
      deltaSpanLanding={overlay.deltaSpanLanding}
      jumpToChunk={jumpToChunk}
      marks={null}
      model={model}
      narrative={null}
      skipReason={null}
    />
  );
}

function renderSection(options: RenderOptions = {}) {
  const compare = options.compare ?? "previous-brief";
  const brief = options.brief ?? FULL_BRIEF;
  const narrative = options.narrative ?? NARRATIVE;
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
  const model = buildBriefViewModel(brief);
  const jumpToChunk = vi.fn();
  let sessionActions: ReviewSessionActions | undefined;
  let dispositionKinds: Record<string, string> = {};
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <TokenPlanProvider briefKey="brief-1" chunkSizes={[]}>
        <ReviewSessionProvider briefId="test-brief" model={model}>
          <ReviewFlowProvider store={flowStore}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <SessionProbe
                onActions={(actions) => {
                  sessionActions = actions;
                }}
                onDispositions={(kinds) => {
                  dispositionKinds = kinds;
                }}
              />
              {options.plan === undefined ? (
                <ChangesOnlyView
                  brief={brief}
                  compare={compare}
                  delta={compare === "last-review" ? DELTA : null}
                  deltaSpan={options.deltaSpan}
                  deltaSpanLanding={options.deltaSpanLanding}
                  jumpToChunk={jumpToChunk}
                  marks={null}
                  model={model}
                  narrative={compare === "previous-brief" ? narrative : null}
                  skipReason={null}
                />
              ) : (
                <OverlayChanges
                  brief={brief}
                  jumpToChunk={jumpToChunk}
                  model={model}
                  plan={options.plan}
                />
              )}
            </ReviewPostureProvider>
          </ReviewFlowProvider>
        </ReviewSessionProvider>
      </TokenPlanProvider>
    </QueryClientProvider>,
  );

  return {
    view,
    flowStore,
    model,
    jumpToChunk,
    getSessionActions: () => sessionActions,
    getDispositionKinds: () => dispositionKinds,
  };
}

describe("flags on a Changes section", () => {
  it("shows the full brief's flags on the chunks the section touches", () => {
    renderSection();

    expect(
      screen.getByRole("heading", {
        name: appI18n.t("brief.group.riskSurface"),
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/a.ts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "src/b.ts" })).toBeNull();
  });

  it("dismisses from the section into the disposition the group card reads", () => {
    const { flowStore, model, getSessionActions, getDispositionKinds } =
      renderSection();
    const flag = model.flags.find(
      (candidate) => candidate.chunkId === "chunk-a",
    );
    if (flag === undefined) {
      throw new Error("expected a flag on chunk-a");
    }

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select flags on src/a.ts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss selected…" }));
    expect(flowStore.getState().dismissTarget).toMatchObject({
      flagIds: [flag.id],
    });

    // What the dismiss modal does on confirm, on the store both surfaces read.
    act(() => {
      getSessionActions()?.disposeFlag([flag.id], {
        kind: "dismissed",
        reason: "known and accepted",
      });
    });

    expect(getDispositionKinds()[flag.id]).toBe("dismissed");
    expect(screen.getByRole("button", { name: "1 resolved" })).toBeTruthy();
  });

  it("lists a matched file of another group under the section", () => {
    renderSection();

    expect(screen.getByRole("button", { name: "src/c.ts" })).toBeTruthy();
  });

  it("shows a remainder flag on a section that touches its file", () => {
    renderSection({ brief: REMAINDER_BRIEF, narrative: REMAINDER_NARRATIVE });

    expect(screen.getByRole("button", { name: "src/key.ts" })).toBeTruthy();
  });

  it("shows the flags under a Your last review section too", () => {
    renderSection({ compare: "last-review" });

    expect(
      screen.getByRole("heading", {
        name: appI18n.t("brief.group.riskSurface"),
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/a.ts" })).toBeTruthy();
  });

  it("jumps to the flagged chunk through the screen's Changes exit", () => {
    const { jumpToChunk } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "src/a.ts" }));

    expect(jumpToChunk).toHaveBeenCalledWith("chunk-a");
  });
});

describe("ChangesOnlyView on a delta span GitHub did not render in time", () => {
  it("shows one timeout notice above the cards and retries the span", () => {
    const retry = vi.fn();
    renderSection({
      compare: "last-review",
      deltaSpan: DeltaSpanStatuses.TIMED_OUT,
      deltaSpanLanding: {
        retry: {
          pending: false,
          failureCount: 1,
          retry,
          releaseFocus: vi.fn(),
        },
        announcement: "",
        sectionRef: { current: null },
      },
    });

    expect(screen.getAllByTestId("diff-timeout-notice")).toHaveLength(1);
    expect(
      screen.queryByText("The raw diff is not viewable right now."),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  const timeout = new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff");
  const marks: ComparisonMarks = {
    baselineSha: "chk1234",
    headSha: "head1234",
    baselineLabel: "checkpoint",
    baselineIndex: 1,
    files: [],
  };

  function stubLastReviewPlan(spanFn: () => Promise<string>) {
    return {
      lastReview: {
        marks: {
          queryKey: ["marks"],
          queryFn: async () => marks,
          retry: false,
        },
        delta: {
          queryKey: ["delta"],
          queryFn: async () => DELTA,
          retry: false,
        },
        rawDiff: { queryKey: ["span"], queryFn: spanFn, retry: false },
      },
    } satisfies BriefComparisonPlan;
  }

  it("lands focus on the section and says the diff loaded on retry", async () => {
    const spanFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce("");
    renderSection({ compare: "last-review", plan: stubLastReviewPlan(spanFn) });
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.queryByTestId("diff-timeout-notice")).toBeNull(),
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("last-review-changes"),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Diff loaded."),
    );
  });

  it("keeps focus on Try again when the span times out again", async () => {
    const spanFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout);
    renderSection({ compare: "last-review", plan: stubLastReviewPlan(spanFn) });
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(spanFn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBe(button),
    );
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("lands focus on the section when the span retry fails otherwise", async () => {
    const spanFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(
        new ApiError(ApiErrorCodes.GITHUB_UNAVAILABLE, 502, "/diff"),
      );
    renderSection({ compare: "last-review", plan: stubLastReviewPlan(spanFn) });
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.queryByTestId("diff-timeout-notice")).toBeNull(),
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("last-review-changes"),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "The diff did not load.",
      ),
    );
  });
});
