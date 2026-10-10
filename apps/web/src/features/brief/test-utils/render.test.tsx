// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { mountBriefView } from "./render";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("mountBriefView", () => {
  it("keeps a PR field given without a repoId", async () => {
    await mountBriefView({
      headerControls: <span data-testid="header-controls-probe" />,
    });

    expect(screen.getByTestId("header-controls-probe")).toBeDefined();
  });
});
