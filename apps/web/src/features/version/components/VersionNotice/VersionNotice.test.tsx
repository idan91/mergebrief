// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { VersionResponse } from "contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildVersionQueryOptions } from "../../queries";
import { NoticeSurfaces, VersionStates, type VersionState } from "../../types";
import { VersionNotice } from ".";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const AVAILABLE: VersionResponse = {
  version: "1.4.0",
  latest: "1.6.0",
  releaseNotesUrl: "https://example.test/releases/v1.6.0",
  checkedAt: "2026-10-03T10:00:00.000Z",
  breaking: false,
  security: false,
};

function renderNotice(state: VersionState): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildVersionQueryOptions().queryKey, state);
  render(
    <QueryClientProvider client={queryClient}>
      <VersionNotice surface={NoticeSurfaces.HOME} />
    </QueryClientProvider>,
  );
}

function makeKnown(snapshot: VersionResponse): VersionState {
  return { kind: VersionStates.KNOWN, snapshot };
}

describe("VersionNotice", () => {
  it("announces the available release with its notes link and a dismiss", () => {
    renderNotice(makeKnown(AVAILABLE));

    const band = screen.getByRole("status", { name: "New version notice" });
    expect(band.textContent).toContain("MergeBrief 1.6.0 is available.");
    expect(band.textContent).toContain("This instance runs 1.4.0.");
    const notes = screen.getByRole("link", { name: /Release notes/ });
    expect(notes.getAttribute("href")).toBe(AVAILABLE.releaseNotesUrl);
    expect(notes.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(band.getAttribute("data-tone")).toBeNull();
  });

  it("names the extra step when a release in the gap is breaking", () => {
    renderNotice(makeKnown({ ...AVAILABLE, breaking: true }));

    expect(screen.getByRole("status").textContent).toContain(
      "This upgrade needs an extra step",
    );
  });

  it("renders a security release in the warning tone with no dismiss", () => {
    renderNotice(makeKnown({ ...AVAILABLE, security: true }));

    const band = screen.getByRole("status", { name: "New version notice" });
    expect(band.textContent).toContain(
      "MergeBrief 1.6.0 fixes a security issue.",
    );
    expect(band.getAttribute("data-tone")).toBe("warning");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("renders nothing when no release check has succeeded", () => {
    renderNotice(makeKnown({ version: "1.4.0" }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing for a signed-out viewer", () => {
    renderNotice({ kind: VersionStates.SIGNED_OUT });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismiss posts the release, hides the band and focuses the content", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.append(main);
    renderNotice(makeKnown(AVAILABLE));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/version/dismiss");
    expect(init).toMatchObject({ method: "POST" });
    const body = typeof init?.body === "string" ? init.body : "";
    expect(JSON.parse(body)).toEqual({ version: "1.6.0" });
    expect(document.activeElement).toBe(main);
    main.remove();
  });

  it("keeps the band when the dismiss write fails", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "x", code: "internal-error" }, { status: 500 }),
    );
    renderNotice(makeKnown(AVAILABLE));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
