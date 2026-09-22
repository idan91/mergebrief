// @vitest-environment jsdom
// Picker-state tests for the DB-backed PR section.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PrSummary } from "../../types";
import { PullsSection } from "./PullsSection";

afterEach(cleanup);

function pull(overrides: Partial<PrSummary>): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "feat: widgets",
    state: "open",
    baseSha: "base-1",
    headSha: "headsha1234567",
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    behind: false,
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

describe("PullsSection", () => {
  it("logged out → login CTA pointing at the OAuth entry", () => {
    render(<PullsSection session={{ kind: "logged-out" }} />);
    const cta = screen.getByRole("link", { name: /sign in with github/i });
    expect(cta.getAttribute("href")).toBe("/api/auth/github");
  });

  it("unavailable → degraded status note, no rows, no CTA", () => {
    render(<PullsSection session={{ kind: "unavailable" }} />);
    expect(screen.getByRole("status").textContent).toMatch(/unavailable/i);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ready + empty → activation hint", () => {
    render(<PullsSection session={{ kind: "ready", pulls: [] }} />);
    expect(screen.getByText(/no pull requests yet/i)).toBeTruthy();
  });

  it("ready → rows link to the deep-link URL with title and status text", () => {
    render(
      <PullsSection
        session={{
          kind: "ready",
          pulls: [
            pull({}),
            pull({
              prNumber: 8,
              title: null,
              briefAvailable: false,
              baseSha: null,
              generation: {
                status: "running",
                phase: "generating",
                attempts: 0,
                errorCode: null,
                errorDetail: null,
                updatedAt: "2026-07-06T12:00:00.000Z",
              },
            }),
          ],
        }}
      />,
    );

    const ready = screen.getByRole("link", { name: /feat: widgets/i });
    expect(ready.getAttribute("href")).toBe("/repos/424242/pulls/7");
    expect(ready.textContent).toContain("brief ready");
    expect(ready.textContent).toContain("headsha".slice(0, 7));

    // Titleless waiting row falls back to PR #N and announces generation.
    const waiting = screen.getByRole("link", { name: /PR #8/i });
    expect(waiting.textContent).toContain("generating…");
  });
});
