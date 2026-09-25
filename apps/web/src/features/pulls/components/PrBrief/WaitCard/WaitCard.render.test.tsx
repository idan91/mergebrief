// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import type { Span } from "../../../utils/briefRouteState";
import { WaitCard } from ".";

vi.mock("@web/utils/diffTokens/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    canTokenizeChunks: () => false,
    warmDiffTokenWorker: () => undefined,
  };
});

const SPAN: Span = { base: "base1234", head: "head1234" };
const REPO_ID = "acme/widgets";
const PR_NUMBER = 7;
const FILE = "src/widgets.ts";
const DIFF_TEXT = [
  `diff --git a/${FILE} b/${FILE}`,
  `--- a/${FILE}`,
  `+++ b/${FILE}`,
  "@@ -1,1 +1,2 @@",
  " const a = 1;",
  "+const b = 2;",
].join("\n");

afterEach(cleanup);

function renderWaitCard(span: Span | undefined): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ["pr-diff", REPO_ID, PR_NUMBER, SPAN.base, SPAN.head],
    DIFF_TEXT,
  );
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <WaitCard
          phase={null}
          prNumber={PR_NUMBER}
          repoId={REPO_ID}
          span={span}
          status="pending"
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("WaitCard", () => {
  it("keeps busy and shows the diff preview inside the block with a span", () => {
    renderWaitCard(SPAN);

    const block = screen.getByTestId("empty-block");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByTestId("empty-block-spinner")).toBeTruthy();
    expect(block.textContent).toContain("Read the raw diff while you wait");
    expect(block.textContent).toContain(FILE);
  });

  it("says the diff is pending and shows no preview without a span", () => {
    renderWaitCard(undefined);

    const block = screen.getByTestId("empty-block");
    expect(screen.getByTestId("empty-block-spinner")).toBeTruthy();
    expect(block.textContent).toContain("once the span is known");
    expect(block.textContent).not.toContain(FILE);
  });
});
