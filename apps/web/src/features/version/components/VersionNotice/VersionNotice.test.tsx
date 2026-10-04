// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { VersionResponse } from "contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "../../../../test/router";
import { buildVersionQueryOptions } from "../../queries";
import { NoticeSurfaces, VersionStates, type VersionState } from "../../types";
import { VersionNotice } from ".";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

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

async function renderNotice(state: VersionState): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildVersionQueryOptions().queryKey, state);
  await renderInRouter(
    <VersionNotice surface={NoticeSurfaces.HOME} />,
    queryClient,
  );
}

function makeKnown(snapshot: VersionResponse): VersionState {
  return { kind: VersionStates.KNOWN, snapshot };
}

describe("VersionNotice", () => {
  it("announces the available release with its notes link and a dismiss", async () => {
    await renderNotice(makeKnown(AVAILABLE));

    const band = screen.getByRole("status", { name: "New version notice" });
    expect(band.textContent).toContain("MergeBrief 1.6.0 is available.");
    expect(band.textContent).toContain("This instance runs 1.4.0.");
    const notes = screen.getByRole("link", { name: /Release notes/ });
    expect(notes.getAttribute("href")).toBe(AVAILABLE.releaseNotesUrl);
    expect(notes.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(band.getAttribute("data-tone")).toBeNull();
  });

  it("names the extra step when a release in the gap is breaking", async () => {
    await renderNotice(makeKnown({ ...AVAILABLE, breaking: true }));

    expect(screen.getByRole("status").textContent).toContain(
      "This upgrade needs an extra step",
    );
  });

  it("renders a security release in the warning tone with no dismiss", async () => {
    await renderNotice(makeKnown({ ...AVAILABLE, security: true }));

    const band = screen.getByRole("status", { name: "New version notice" });
    expect(band.textContent).toContain(
      "MergeBrief 1.6.0 fixes a security issue.",
    );
    expect(band.getAttribute("data-tone")).toBe("warning");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("renders nothing when no release check has succeeded", async () => {
    await renderNotice(makeKnown({ version: "1.4.0" }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing when the instance runs the latest release", async () => {
    await renderNotice(makeKnown({ ...AVAILABLE, latest: "1.4.0" }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing once the viewer dismissed this release", async () => {
    await renderNotice(makeKnown({ ...AVAILABLE, dismissedVersion: "1.6.0" }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores a dismissal of an older release", async () => {
    await renderNotice(makeKnown({ ...AVAILABLE, dismissedVersion: "1.5.0" }));

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps a security release visible after a dismissal", async () => {
    await renderNotice(
      makeKnown({ ...AVAILABLE, security: true, dismissedVersion: "1.6.0" }),
    );

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders nothing for a signed-out viewer", async () => {
    await renderNotice({ kind: VersionStates.SIGNED_OUT });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismiss posts the release, hides the band and focuses the content", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.append(main);
    await renderNotice(makeKnown(AVAILABLE));

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
    await renderNotice(makeKnown(AVAILABLE));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("marks the surface it sits under", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      buildVersionQueryOptions().queryKey,
      makeKnown(AVAILABLE),
    );
    await renderInRouter(
      <VersionNotice surface={NoticeSurfaces.BRIEF} />,
      queryClient,
    );

    expect(screen.getByRole("status").getAttribute("data-surface")).toBe(
      "brief",
    );
  });
});
