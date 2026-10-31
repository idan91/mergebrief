// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AddressedReviewComment } from "@web/features/brief/model";
import { ReviewComments } from ".";

afterEach(cleanup);

const COMMENT: AddressedReviewComment = {
  id: "c1",
  file: "src/\u202Etxt.exe",
  line: 4,
  author: "octocat",
  body: "Looks off.",
  outdated: false,
};

describe("addressed review comments", () => {
  it("names a comment's path with a bidi override by a visible escape", () => {
    render(<ReviewComments comments={[COMMENT]} label="Review comment" />);

    expect(screen.getByText("src/[U+202E]txt.exe:4")).toBeTruthy();
  });
});
