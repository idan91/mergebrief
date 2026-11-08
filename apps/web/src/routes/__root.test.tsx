// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import type { LinkHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appI18n, I18nProvider } from "../i18n/I18nProvider";
import { parseColor, resolvePalette } from "../styles/test-utils";
import { renderInRouter } from "../test/router";
import { Route } from "./__root";

type HeadLink = LinkHTMLAttributes<HTMLLinkElement>;

async function resolveHead() {
  const head = Route.options.head;
  if (head === undefined) {
    throw new Error("the root route declares no head");
  }
  return head({
    loaderData: undefined,
    match: {},
    matches: [],
    params: {},
  } as never);
}

async function resolveHeadLinks(): Promise<HeadLink[]> {
  const resolved = await resolveHead();
  const links = resolved.links ?? [];
  return links.filter((link) => link !== undefined);
}

async function resolveDescriptions(): Promise<string[]> {
  const resolved = await resolveHead();
  const meta = resolved.meta ?? [];
  const descriptions = meta.filter(
    (tag) => tag?.name === "description" || tag?.property === "og:description",
  );
  return descriptions.map((tag) => String(tag?.content));
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

  it("links the pixel-exact 16px icon ahead of the scalable mark", async () => {
    const links = await resolveHeadLinks();
    const icons = links.filter((link) => link.rel === "icon");

    expect(icons.map((link) => [link.href, link.sizes])).toEqual([
      ["/favicon-16.png", "16x16"],
      ["/favicon.svg", undefined],
    ]);
  });

  it("shares the image only as an absolute URL", async () => {
    const resolved = await resolveHead();
    const meta = resolved.meta ?? [];
    const imageTags = meta.filter(
      (tag) => tag?.property === "og:image" || tag?.name === "twitter:image",
    );

    expect(imageTags).toHaveLength(2);
    for (const tag of imageTags) {
      expect(String(tag?.content)).toMatch(/^https?:\/\/[^/]+\/og-image\.png$/);
    }
  });

  it("paints the browser chrome in the page ground", async () => {
    const resolved = await resolveHead();
    const meta = resolved.meta ?? [];
    const themeColor = meta.find((tag) => tag?.name === "theme-color");
    const readColor = await resolvePalette();
    const shipped = parseColor(String(themeColor?.content));

    expect(shipped).toEqual(readColor("--color-background"));
  });

  it("reads both descriptions from the catalog", async () => {
    const owned = appI18n.t("shell.headMeta.description");
    const descriptions = await resolveDescriptions();

    expect(descriptions).toEqual([owned, owned]);
  });

  it("describes the product as source-available, not open source", () => {
    const owned = appI18n.t("shell.headMeta.description");

    expect(owned).toContain("Source-available");
    expect(owned).not.toMatch(/open[- ]source/i);
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
        name: "This page doesn't exist",
      }),
    ).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go home" });
    expect(screen.getByRole("main").contains(home)).toBe(true);
    expect(home.getAttribute("href")).toBe("/");
  });
});
