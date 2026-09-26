// @vitest-environment jsdom
// Escape must leave the composer AND give the reading shortcuts back: it
// clears `activeCommentAnchor`, and while that is set every key belongs to
// the composer. The case lives on the DB path because that is where a
// composer exists at all, a file-backed Brief has no session to write into.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderInRouter } from "../../../../test/router";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import {
  emptySessionPayload,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { BriefView } from ".";
import { briefFixture } from "@web/features/brief/fixtures";

afterEach(cleanup);

async function renderScreen(session: ReviewSessionPayload) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return await renderInRouter(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="composer-keyboard-test"
          searchParams={{}}
          session={session}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

it("keeps J/K/Z working after leaving a comment composer via Escape", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  await renderScreen(emptySessionPayload());

  // Composer entry is gutter-only, the code column is reserved for text
  // selection.
  const gutter = document.querySelector(
    "[data-commentable] [data-comment-anchor]",
  );
  expect(gutter).toBeTruthy();
  fireEvent.mouseDown(gutter as Element);
  fireEvent.mouseUp(gutter as Element);
  await screen.findByPlaceholderText("Leave a comment");

  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull(),
  );

  const before = document.querySelector("article[data-current]")?.id;
  fireEvent.keyDown(window, { key: "j" });
  await waitFor(() =>
    expect(document.querySelector("article[data-current]")?.id).not.toBe(
      before,
    ),
  );
});
