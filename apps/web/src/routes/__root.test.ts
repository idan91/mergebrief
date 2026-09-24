import type { LinkHTMLAttributes } from "react";
import { describe, expect, it } from "vitest";

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
