// @vitest-environment jsdom
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

import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import { briefFixture, briefSummaryFixture } from "../features/brief/fixtures";
import { routeTree } from "../routeTree.gen";

const BRIEF_ID = briefSummaryFixture.id;

async function renderBriefScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    localBriefQueryOptions(BRIEF_ID).queryKey,
    briefFixture,
  );
  queryClient.setQueryData(localBriefsQueryOptions().queryKey, [
    briefSummaryFixture,
  ]);
  queryClient.setQueryData(
    localRevisionChangesQueryOptions(BRIEF_ID).queryKey,
    null,
  );

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/briefs/${BRIEF_ID}`] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
  );
  return { queryClient, router };
}

/**
 * Characterization suite — pins the screen's load-bearing couplings against the
 * pre-split BriefApp so they stay green through the Slice A→D refactor. Asserts
 * behaviour observable through the rendered screen, not store internals.
 */
describe("brief screen characterization", () => {
  afterEach(() => cleanup());

  it("renders the change-group story", async () => {
    await renderBriefScreen();
    expect(screen.getByText(briefFixture.changeGroups[0]!.title)).toBeTruthy();
  });

  it("marking a carrier chunk reviewed advances the chunks progress stat", async () => {
    await renderBriefScreen();
    const stat = () =>
      screen.getByText("chunks").closest(".stat")!.querySelector("b")!
        .textContent;
    expect(stat()).toBe("0/2");
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Viewed/i })[0]!);
    await waitFor(() => expect(stat()).toBe("1/2"));
  });

  it("dismissing a flag advances the flags progress stat", async () => {
    await renderBriefScreen();
    const stat = () =>
      screen.getByText("flags").closest(".stat")!.querySelector("b")!
        .textContent;
    expect(stat()).toBe("0/1");
    fireEvent.click(screen.getByText("Dismiss…"));
    const reason = await screen.findByPlaceholderText(/Your reason lands/);
    fireEvent.change(reason, {
      target: { value: "Not applicable in this local fixture." },
    });
    fireEvent.click(screen.getByText("Dismiss with reason"));
    await waitFor(() => expect(stat()).toBe("1/1"));
  });

  it("reclassifying an uncertain group records the override on the card", async () => {
    await renderBriefScreen();
    expect(screen.queryByText("set by you · recorded on receipt")).toBeNull();
    // The uncertain pick buttons offer the between-categories.
    fireEvent.click(screen.getByRole("button", { name: "logic-refactor" }));
    await waitFor(() =>
      expect(screen.getByText("set by you · recorded on receipt")).toBeTruthy(),
    );
  });
});
