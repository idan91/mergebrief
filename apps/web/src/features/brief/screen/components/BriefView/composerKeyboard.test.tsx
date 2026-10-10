// @vitest-environment jsdom
// Escape must leave the composer AND give the reading shortcuts back: it
// clears `activeCommentAnchor`, and while that is set every key belongs to
// the composer. The case lives on the DB path because that is where a
// composer exists at all, a file-backed Brief has no session to write into.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { emptySessionPayload } from "@web/features/review/session";
import { mountBriefView } from "../../../test-utils";

afterEach(cleanup);

it("keeps J/K/Z working after leaving a comment composer via Escape", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  await mountBriefView({ session: emptySessionPayload() });

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
