// @vitest-environment jsdom
import type { PrLevelCommentView } from "contract";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PrCommentRow } from ".";

const ASSET_URL =
  "https://github.com/user-attachments/assets/3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";

function makeComment(body: string): PrLevelCommentView {
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

  it("labels a code-only body through the catalog when collapsed", () => {
    render(
      <PrCommentRow
        comment={makeComment("```suggestion\nconst x = 2;\n```")}
        expanded={false}
        toggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button").textContent).toContain(
      "suggested change",
    );
  });
});
