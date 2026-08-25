// @vitest-environment jsdom
// Picker-state tests for the "your briefs" (url-box) section.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrSummary } from "../../types";
import { YourBriefsSection } from "./YourBriefsSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function pull(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "feat: widgets",
    state: "merged",
    baseSha: "base-1",
    headSha: "headsha1234567",
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...overrides,
  };
}

describe("YourBriefsSection", () => {
  it("renders nothing while signed out — the pulls section owns the CTA", () => {
    renderWithClient(<YourBriefsSection session={{ kind: "logged-out" }} />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("ready + empty → the paste-a-URL hint", () => {
    renderWithClient(
      <YourBriefsSection session={{ kind: "ready", pulls: [] }} />,
    );
    expect(screen.getByText(/paste a pull request url/i)).toBeTruthy();
  });

  it("rows deep-link to the repo route and carry a per-row delete", () => {
    renderWithClient(
      <YourBriefsSection session={{ kind: "ready", pulls: [pull({})] }} />,
    );
    const row = screen.getByRole("link", { name: /feat: widgets/i });
    expect(row.getAttribute("href")).toBe("/repos/424242/pulls/7");
    expect(
      screen.getByRole("button", {
        name: /delete the brief for octo\/hello #7/i,
      }),
    ).toBeTruthy();
  });

  it("delete fires DELETE /api/briefs/:repoId/:prNumber and disables the row's button", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(
      <YourBriefsSection session={{ kind: "ready", pulls: [pull({})] }} />,
    );
    const button = screen.getByRole("button", {
      name: /delete the brief for octo\/hello #7/i,
    });
    fireEvent.click(button);
    // The shared Button uses aria-disabled, never the native attribute.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/briefs/424242/7", {
        method: "DELETE",
      }),
    );
  });
});
