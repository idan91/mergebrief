// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrLevelComment } from "../../../../types";
import { PrCommentRow } from ".";

afterEach(cleanup);

const ASSET_URL =
  "https://github.com/user-attachments/assets/3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";

function makeComment(body: string): PrLevelComment {
  return {
    commentId: 77,
    author: { login: "octocat", isBot: false },
    body,
    createdAt: "2026-09-26T10:00:00.000Z",
    url: "https://github.com/acme/app/pull/7#issuecomment-77",
  };
}

describe("PrCommentRow body", () => {
  it("renders a pasted screenshot as an image when expanded", () => {
    render(
      <PrCommentRow
        comment={makeComment(
          `See below\n\n<img width="10" height="10" alt="Image" src="${ASSET_URL}" />`,
        )}
        expanded
        toggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Image" }).getAttribute("src")).toBe(
      ASSET_URL,
    );
    expect(screen.queryByText(/<img/)).toBeNull();
  });
});
