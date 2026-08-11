// @vitest-environment jsdom
// Flat at the feature root with reason: the subject is src/routes' file-based
// route, where a .test file could trip route generation, so it is exercised
// from the owning feature instead. The revision-timeline path through the real
// router: a multi-revision PR-meta exposes the navigator, `?head=` selects a
// historical revision (with ITS OWN base), unknown heads degrade to latest
// with a note. Stale-head views (historical, or head advanced past the newest
// brief) are WRITABLE with a submit ack; only a superseded base stays hard
// read-only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import type { ComparisonMarks } from "@web/features/brief/types";
import { routeTree } from "../../routeTree.gen";
import {
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "./queries";
import type { PrSummary, RevisionSummary } from "./types";

const REPO_ID = "424242";
const PR_NUMBER = 7;

/** Runtime-narrow the router's search state (repo rule: no bare `as`). */
function searchRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a search params object");
  }
  return Object.fromEntries(Object.entries(value));
}

// Two briefed revisions, base drifts across them (b1 → b2b).
const REV1: RevisionSummary = {
  headSha: "head-1",
  baseSha: "base-1",
  headIndex: 1,
  createdAt: "2026-07-05T12:00:00.000Z",
  comparisons: {},
};
const REV2: RevisionSummary = {
  headSha: "head-2",
  baseSha: "base-2b",
  headIndex: 2,
  createdAt: "2026-07-06T12:00:00.000Z",
  comparisons: {},
};

function timelineMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    repoId: REPO_ID,
    repoSlug: "octo/hello",
    prNumber: PR_NUMBER,
    title: "t",
    state: "open",
    baseSha: REV2.baseSha,
    headSha: REV2.headSha,
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
    revisions: [REV1, REV2],
    ...overrides,
  };
}

async function renderTimeline(
  path: string,
  metaValue = timelineMeta(),
  seedExtra?: (queryClient: QueryClient) => void,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    metaValue,
  );
  seedExtra?.(queryClient);
  // Seed a brief + diff per revision in the meta, whatever the fixture.
  for (const rev of metaValue.revisions ?? []) {
    queryClient.setQueryData(
      dbBriefQueryOptions(REPO_ID, PR_NUMBER, rev.baseSha, rev.headSha)
        .queryKey,
      briefFixture,
    );
    queryClient.setQueryData(
      prDiffQueryOptions(REPO_ID, PR_NUMBER, rev.baseSha, rev.headSha).queryKey,
      "",
    );
  }
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("DB brief route — revision timeline", () => {
  afterEach(() => cleanup());

  it("renders the navigator with every revision in order, latest selected", async () => {
    await renderTimeline(`/repos/${REPO_ID}/pulls/${PR_NUMBER}`);
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    const options = [...picker.options].map((o) => o.value);
    expect(options).toEqual(["0", "1"]);
    expect(picker.value).toBe("1");
  });

  it("selects a historical revision from ?head= — writable, submit gated by the stale ack", async () => {
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV1.headSha}`,
    );
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    expect(picker.value).toBe("0");
    // No hard block: the read-only reason and posture are gone…
    expect(screen.queryByText(/viewing an earlier revision/i)).toBeNull();
    expect(screen.getByText(/^viewing revision 1 of 2\.$/i)).toBeTruthy();
    // …and the receipt carries the stale-submit ack instead.
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    // The advisory view fronts the modal when unresolved items exist;
    // Continue reaches the verdict view, which carries the ack.
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(
      screen.getByText(/comments will anchor to the revision you reviewed/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: /submit against the reviewed revision anyway/i,
      }),
    ).toBeTruthy();
  });

  it("the latest revision is writable (no read-only reason)", async () => {
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV2.headSha}`,
    );
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(screen.queryByText(/viewing an earlier revision/i)).toBeNull();
  });

  it("gates submit behind the ack when meta.headSha advanced past the newest revision", async () => {
    // The newest revision is not the PR's current head (next brief still
    // generating): writable, but the receipt requires the stale ack —
    // comments would anchor to the reviewed head.
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV2.headSha}`,
      timelineMeta({ headSha: "head-3-just-pushed", baseSha: "base-3" }),
    );
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    expect(picker.value).toBe("1");
    expect(screen.getByText(/^viewing revision 2 of 2\.$/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    // The advisory view fronts the modal when unresolved items exist;
    // Continue reaches the verdict view, which carries the ack.
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    // The ack gate reached the drawer (plumbing proof — the disabled-until-
    // acked mechanics are pinned in SubmitModal.test).
    expect(
      screen.getByText(/comments will anchor to the revision you reviewed/i),
    ).toBeTruthy();
    const ack = screen.getByRole("checkbox", {
      name: /submit against the reviewed revision anyway/i,
    });
    fireEvent.click(ack);
    expect(ack).toHaveProperty("checked", true);
  });

  it("group since-marker links into the delta lens", async () => {
    // A checkpoint exists on the latest revision; the viewer is on Full
    // Brief with Compare OFF — the marker must still show and its link
    // must flip the search to the delta lens.
    const metaValue = timelineMeta({
      revisions: [
        REV1,
        {
          ...REV2,
          comparisons: {
            lastReview: {
              kind: "available",
              deltaAvailable: false,
              baselineSha: "chk1234deadbeef00",
              baselineIndex: 1,
            },
          },
        },
      ],
    });
    const queryClientSeed = (queryClient: QueryClient) => {
      const marks: ComparisonMarks = {
        baselineSha: "chk1234deadbeef00",
        headSha: REV2.headSha,
        baselineLabel: "checkpoint",
        baselineIndex: 1,
        files: [
          {
            file: "src/leak.ts",
            addedRanges: [{ start: 1, end: 1 }],
            removedRanges: [],
          },
        ],
      };
      queryClient.setQueryData(
        dbComparisonMarksQueryOptions(
          REPO_ID,
          PR_NUMBER,
          "chk1234deadbeef00",
          REV2.headSha,
          "checkpoint",
          1,
        ).queryKey,
        marks,
      );
    };
    const router = await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV2.headSha}&view=full&compare=off`,
      metaValue,
      queryClientSeed,
    );
    const marker = await waitFor(() =>
      screen.getByRole("button", { name: /1 file changed since chk1234/i }),
    );
    fireEvent.click(marker);
    await waitFor(() => {
      const search = searchRecord(router.state.location.search);
      expect(search["compare"]).toBe("last-review");
    });
  });

  it("opens the conversation section when ?thread= arrives via in-app navigation", async () => {
    const router = await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV2.headSha}`,
    );
    const heading = await waitFor(() => {
      const el = document.getElementById("conversation-heading");
      if (el === null) throw new Error("no conversation heading yet");
      return el;
    });
    // Collapsed by default — no thread target in the URL.
    expect(heading.getAttribute("aria-expanded")).toBe("false");
    // The jump navigates in-app (same mounted route): the section must open
    // from the effect, not only the initializer.
    await router.navigate({
      to: "/repos/$repoId/pulls/$prNumber",
      params: { repoId: REPO_ID, prNumber: String(PR_NUMBER) },
      search: { head: REV2.headSha, base: REV2.baseSha, thread: 7777 },
    });
    await waitFor(() =>
      expect(
        document
          .getElementById("conversation-heading")
          ?.getAttribute("aria-expanded"),
      ).toBe("true"),
    );
  });

  it("keeps the selected historical head when view/compare changes (search updater merges)", async () => {
    // The Brief view/compare controls navigate through a FUNCTIONAL search
    // updater (`(current) => ({ ...current, ...next })`), so changing a lens
    // must never drop head/base and silently re-resolve to latest.
    const router = await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV1.headSha}&base=${REV1.baseSha}`,
    );
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    expect(picker.value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: /^full brief$/i }));
    await waitFor(() => {
      const search = searchRecord(router.state.location.search);
      expect(search["view"]).toBe("full");
      // The historical selection survives the lens change…
      expect(search["head"]).toBe("head-1");
      expect(search["base"]).toBe("base-1");
    });
    // …and so does the stale (not read-only) posture: no read-only chip.
    expect(screen.queryByText(/^read-only$/i)).toBeNull();
  });

  it("degrades an unknown ?head= to latest with a polite note", async () => {
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=never-briefed`,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/that revision link is no longer available/i),
      ).toBeTruthy(),
    );
    const picker =
      screen.getByLabelText<HTMLSelectElement>("Select PR revision");
    expect(picker.value).toBe("1");
  });

  it("navigates to the picked revision's head on selection", async () => {
    const router = await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=${REV2.headSha}`,
    );
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    fireEvent.change(picker, { target: { value: "0" } });
    await waitFor(() => {
      const search = searchRecord(router.state.location.search);
      expect(search["head"]).toBe("head-1");
      // The revision's OWN base is written, not the top-level view's.
      expect(search["base"]).toBe("base-1");
    });
  });

  it("addresses duplicate-head revisions by exact span, read-only on the stale base (retarget re-brief)", async () => {
    // The brief natural key is (pr, base, head): after a retarget re-brief
    // the SAME head appears twice with different bases.
    const oldSpan: RevisionSummary = {
      headSha: "head-2",
      baseSha: "base-old",
      headIndex: 2,
      createdAt: "2026-07-06T11:00:00.000Z",
      comparisons: {},
    };
    const newSpan: RevisionSummary = {
      headSha: "head-2",
      baseSha: "base-new",
      headIndex: 3,
      createdAt: "2026-07-06T12:00:00.000Z",
      comparisons: {},
    };
    const metaValue = timelineMeta({
      headSha: "head-2",
      baseSha: "base-new",
      revisions: [REV1, oldSpan, newSpan],
    });

    // ?head=&base= addresses the OLDER duplicate exactly…
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=head-2&base=base-old`,
      metaValue,
    );
    const picker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    expect(picker.value).toBe("1");
    // …its picker entry is disambiguated by base…
    expect(
      screen.getByRole("option", { name: /revision 2.*base base-ol/i }),
    ).toBeDefined();
    // …and although its head IS the current head, its base is superseded —
    // writes stay disabled with the base-drift reason (anchors would be read
    // against a diff that is not the PR's current one).
    expect(
      screen.getAllByText(/generated against a superseded base/i).length,
    ).toBeGreaterThan(0);
    // Moving to the SAME-HEAD newer duplicate re-anchors keyboard focus —
    // the focus effect keys on the full span, not the head SHA: only the base
    // changes here, yet the content and read-only posture swap.
    picker.focus();
    expect(document.activeElement).toBe(picker);
    fireEvent.change(picker, { target: { value: "2" } });
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("main-content"),
    );
    cleanup();

    // A BARE head resolves to the newest duplicate (backend at(-1) choice),
    // which is the current span → writable.
    await renderTimeline(
      `/repos/${REPO_ID}/pulls/${PR_NUMBER}?head=head-2`,
      metaValue,
    );
    const bareHeadPicker = await waitFor(() =>
      screen.getByLabelText<HTMLSelectElement>("Select PR revision"),
    );
    expect(bareHeadPicker.value).toBe("2");
    expect(screen.queryByText(/superseded base/i)).toBeNull();
    expect(screen.queryByText(/viewing an earlier revision/i)).toBeNull();
  });
});
