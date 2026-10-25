// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import type { LinkHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { renderInRouter } from "../test/router";
import { Route } from "./__root";

type HeadLink = LinkHTMLAttributes<HTMLLinkElement>;

async function resolveHeadLinks(): Promise<HeadLink[]> {
  const head = Route.options.head;
  if (head === undefined) {
    throw new Error("the root route declares no head");
  }
  const resolved = await head({
    loaderData: undefined,
    match: {},
    matches: [],
    params: {},
  } as never);
  const links = resolved.links ?? [];
  return links.filter((link) => link !== undefined);
}

describe("root route head", () => {
  it("preloads the two body fonts as same-origin woff2", async () => {
    const links = await resolveHeadLinks();
    const preloads = links.filter((link) => link.rel === "preload");

    expect(preloads).toHaveLength(2);
    for (const link of preloads) {
      expect(link.as).toBe("font");
      expect(link.type).toBe("font/woff2");
      expect(link.crossOrigin).toBe("anonymous");
      expect(link.href).toMatch(/latin-400-normal\.woff2$/);
    }
    const families = preloads.map((link) => link.href ?? "");
    expect(families.some((href) => href.includes("ibm-plex-sans"))).toBe(true);
    expect(families.some((href) => href.includes("ibm-plex-mono"))).toBe(true);
  });

  it("reaches no font host", async () => {
    const links = await resolveHeadLinks();
    const hrefs = links.map((link) => link.href ?? "");

    expect(hrefs.some((href) => href.includes("googleapis"))).toBe(false);
    expect(hrefs.some((href) => href.includes("gstatic"))).toBe(false);
  });
});

describe("root route not found", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says the page does not exist and links home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const NotFound = Route.options.notFoundComponent;
    if (NotFound === undefined) {
      throw new Error("the root route declares no notFoundComponent");
    }

    await renderInRouter(
      <I18nProvider>
        <NotFound data={undefined} isNotFound routeId="__root__" />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This page doesn't exist.",
      }),
    ).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go Home" });
    expect(screen.getByRole("main").contains(home)).toBe(true);
    expect(home.getAttribute("href")).toBe("/");
  });
});
