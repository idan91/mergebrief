// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefAddressPort } from "@web/features/brief";
import type { UsePrBriefPlansValue } from "../../../hooks/usePrBriefPlans";
import { briefFixture } from "@web/features/brief/test-utils";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { buildDbBriefQueryOptions } from "../../../queries";
import type { PrSummary } from "../../../types";
import type { NewerCommitsChipState } from "./DbBriefControls/NewerCommitsChip/types";
import { PrBriefContent } from ".";

const newerCommits = vi.hoisted((): { state: NewerCommitsChipState } => ({
  state: { announcement: "" },
}));

vi.mock("@web/features/brief", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BriefView: () => null,
  useBriefReading: () => ({}),
}));

vi.mock("../../../hooks/usePrBriefPlans", () => ({
  usePrBriefPlans: (): Partial<UsePrBriefPlansValue> => ({
    briefId: "brief-1",
    availability: { previousBrief: false, lastReview: false },
  }),
}));

vi.mock("./DbBriefControls/NewerCommitsChip/hooks/useNewerCommits", () => ({
  useNewerCommits: () => newerCommits.state,
}));

const SPAN = { base: "base-1", head: "head-1" };

const META: PrSummary = {
  repoId: "424242",
  repoSlug: "octo/hello",
  prNumber: 7,
  title: "t",
  state: "open",
  headSha: "head-2",
  briefAvailable: true,
  draft: false,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  viewerCanPush: false,
  appInstalled: true,
  behind: false,
  updatedAt: "2026-07-06T12:00:00.000Z",
};

function ignoreNavigation(): void {}

const IGNORED_ADDRESS: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreNavigation,
  setFocusParam: ignoreNavigation,
  clearDiffParam: ignoreNavigation,
  navigateSearch: ignoreNavigation,
};

function makeQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const briefQuery = buildDbBriefQueryOptions(
    META.repoId,
    META.prNumber,
    SPAN.base,
    SPAN.head,
  );
  client.setQueryData(briefQuery.queryKey, briefFixture);
  return client;
}

function makeContent(client: QueryClient) {
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <PrBriefContent
            address={IGNORED_ADDRESS}
            meta={META}
            prNumber={META.prNumber}
            repoId={META.repoId}
            searchParams={{}}
            span={SPAN}
            onConversationFilterChange={ignoreNavigation}
          />
        </Suspense>
      </QueryClientProvider>
    </I18nProvider>
  );
}

function getStatusRegion(text: string): HTMLElement {
  const region = screen
    .getAllByRole("status")
    .find((candidate) => candidate.textContent === text);
  if (region === undefined) {
    throw new Error(`No status region reads "${text}"`);
  }
  return region;
}

describe("PrBriefContent newer-commits announcements", () => {
  afterEach(() => {
    cleanup();
    newerCommits.state = { announcement: "" };
  });

  it("announces outside the header, which a phone does not show", () => {
    newerCommits.state = { announcement: "New brief queued." };
    render(makeContent(makeQueryClient()));

    const region = getStatusRegion("New brief queued.");
    expect(region.getAttribute("aria-atomic")).toBe("true");
  });

  it("fills a region the page already rendered empty", () => {
    const client = makeQueryClient();
    const view = render(makeContent(client));
    const emptyRegions = screen.getAllByRole("status");

    newerCommits.state = { announcement: "New brief queued." };
    view.rerender(makeContent(client));
    const queued = getStatusRegion("New brief queued.");
    expect(emptyRegions).toContain(queued);

    newerCommits.state = { announcement: "The new brief is ready." };
    view.rerender(makeContent(client));
    expect(getStatusRegion("The new brief is ready.")).toBe(queued);
  });
});
