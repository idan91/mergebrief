// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ButtonVariants } from "@web/components/Button";
import { InstallFirst } from "./index";

vi.mock("../UrlBox", () => ({
  UrlBox: ({ generateVariant }: { generateVariant?: string }) => (
    <input aria-label="Pull request URL" data-variant={generateVariant} />
  ),
}));

describe("InstallFirst", () => {
  afterEach(cleanup);

  it("leads with installing the App and keeps the URL box below it", () => {
    render(
      <InstallFirst
        canGenerate
        installUrl="https://github.com/apps/x/installations/new"
      />,
    );

    const install = screen.getByRole("link", { name: "Install on GitHub" });
    const box = screen.getByLabelText("Pull request URL");
    expect(install.getAttribute("href")).toContain("installations/new");
    const order = install.compareDocumentPosition(box);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.dataset["variant"]).toBe(ButtonVariants.SECONDARY);
  });

  it("offers only the install path where nothing can generate", () => {
    render(<InstallFirst canGenerate={false} installUrl="https://x.example" />);

    expect(screen.queryByText("Or brief one pull request")).toBeNull();
  });
});
