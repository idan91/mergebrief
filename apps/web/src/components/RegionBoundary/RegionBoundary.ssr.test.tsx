// No jsdom: this renders the way the server does, streaming included.
import { QueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  createRequestHandler,
  defaultStreamHandler,
} from "@tanstack/react-router/ssr/server";
import { useId } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { PageError } from "../PageError";
import { RegionBoundary } from ".";

const SIBLING_TEXT = "The story of this change";
const REGION_TEXT = "Two threads";
const REGION_HEADING = "The conversation could not be shown";
const BOUNDARY_MARKERS = /<!--\/?\$-->/g;
/** The router stamps each match with the clock; one fixed time keeps two renders comparable. */
const RENDER_TIME = new Date("2026-11-15T12:00:00Z");

const region = { holds: true, throws: false };

function countMarkers(html: string): number {
  return html.match(BOUNDARY_MARKERS)?.length ?? 0;
}

function ConversationRegion() {
  const id = useId();
  if (region.throws) {
    throw new Error("render failed");
  }
  return <p id={id}>{REGION_TEXT}</p>;
}

function BriefPage() {
  return (
    <main>
      <p>{SIBLING_TEXT}</p>
      <RegionBoundary
        heading={<h2>{REGION_HEADING}</h2>}
        holdsServerFailure={region.holds}
        resetKey="brief-1"
      >
        <ConversationRegion />
      </RegionBoundary>
    </main>
  );
}

const rootRoute = createRootRoute({ errorComponent: PageError });
const briefRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/brief",
  component: BriefPage,
});

async function renderBriefPage(): Promise<string> {
  const handle = createRequestHandler({
    request: new Request("http://localhost/brief"),
    createRouter: () =>
      createRouter({
        routeTree: rootRoute.addChildren([briefRoute]),
        context: { queryClient: new QueryClient() },
        defaultErrorComponent: PageError,
      }),
  });
  const response = await handle(defaultStreamHandler);

  return response.text();
}

afterEach(() => {
  region.holds = true;
  region.throws = false;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a region that throws on the server render", () => {
  it("blanks the whole route when the region does not hold it", async () => {
    region.holds = false;
    region.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const html = await renderBriefPage();

    expect(html).not.toContain(SIBLING_TEXT);
    expect(html).not.toContain(REGION_HEADING);
  });

  it("keeps the rest of the page when the region holds it", async () => {
    region.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const html = await renderBriefPage();

    expect(html).toContain(SIBLING_TEXT);
    expect(html).toContain(REGION_HEADING);
    expect(html).not.toContain(REGION_TEXT);
    expect(html).not.toContain(appI18n.t("shell.pageFailed.heading"));
  });
});

describe("a holding region that renders on the server", () => {
  it("renders its content", async () => {
    const html = await renderBriefPage();

    expect(html).toContain(REGION_TEXT);
    expect(html).not.toContain(REGION_HEADING);
  });

  it("ships the same HTML as a plain region apart from boundary markers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(RENDER_TIME);
    const held = await renderBriefPage();
    region.holds = false;
    const plain = await renderBriefPage();

    expect(countMarkers(held)).toBe(countMarkers(plain) + 2);
    expect(held.replaceAll(BOUNDARY_MARKERS, "")).toBe(
      plain.replaceAll(BOUNDARY_MARKERS, ""),
    );
  });
});
