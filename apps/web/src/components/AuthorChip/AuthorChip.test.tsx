// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorChip } from ".";

describe("AuthorChip", () => {
  it("links the login to the profile with a decorative avatar", () => {
    const { container } = render(<AuthorChip login="mira-k" />);

    const link = screen.getByRole("link", { name: /^mira-k/ });
    expect(link.getAttribute("href")).toBe("https://github.com/mira-k");
    expect(link.getAttribute("target")).toBe("_blank");
    const avatar = container.querySelector("img");
    expect(avatar?.getAttribute("alt")).toBe("");
    expect(avatar?.getAttribute("src")).toBe(
      "https://github.com/mira-k.png?size=48",
    );
  });

  it("falls back to the initial when the avatar fails to load", () => {
    const { container } = render(<AuthorChip login="mira-k" />);

    const avatar = container.querySelector("img");
    if (avatar === null) {
      throw new Error("unreachable");
    }
    fireEvent.error(avatar);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("M").getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a fresh avatar for a new login after a failure", () => {
    const { container, rerender } = render(<AuthorChip login="mira-k" />);
    const avatar = container.querySelector("img");
    if (avatar === null) {
      throw new Error("unreachable");
    }
    fireEvent.error(avatar);

    rerender(<AuthorChip login="octocat" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://github.com/octocat.png?size=48",
    );
  });

  it("links a bot to its App page and shows its initial", () => {
    const { container } = render(<AuthorChip login="dependabot[bot]" />);

    const link = screen.getByRole("link", { name: /^dependabot\[bot\]/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/apps/dependabot",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a value that is no GitHub login as plain text", () => {
    render(<AuthorChip login="../evil" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("../evil")).toBeTruthy();
  });

  it("renders the avatar and login as plain text when unlinked", () => {
    const { container } = render(<AuthorChip linked={false} login="mira-k" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("author-chip").textContent).toBe("mira-k");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
