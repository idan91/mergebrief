// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentionTargetsScope, type MentionTargets } from "../context";
import { MentionText } from ".";

const RESOLVED_CARA: MentionTargets = {
  isTargetShown: (target) => target.toLowerCase() === "cara",
  requestTarget: vi.fn(),
};

describe("MentionText", () => {
  afterEach(cleanup);

  it("keeps plain text as written and marks each mention", () => {
    const { container } = render(
      <MentionText text="ask @cara or @acme/core, not a@b.com" />,
    );

    expect(container.textContent).toBe("ask @cara or @acme/core, not a@b.com");
    const marked = screen
      .getAllByTestId("mention")
      .map((node) => node.textContent);
    expect(marked).toEqual(["@cara", "@acme/core"]);
  });

  it("leaves a mention in a code span or URL as typed", () => {
    render(<MentionText text="the `@Test` hook, https://x.test/@cara, @dan" />);

    const marked = screen
      .getAllByTestId("mention")
      .map((node) => node.textContent);
    expect(marked).toEqual(["@dan"]);
  });

  it("links a mention GitHub shows the viewer", () => {
    render(
      <MentionTargetsScope value={RESOLVED_CARA}>
        <MentionText text="thanks @cara" />
      </MentionTargetsScope>,
    );

    const link = screen.getByRole("link", { name: "@cara" });
    expect(link.getAttribute("href")).toBe("https://github.com/cara");
  });
});
