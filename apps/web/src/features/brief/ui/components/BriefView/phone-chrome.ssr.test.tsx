// No jsdom: renders the way the server does, before any viewport is read.
import { describe, expect, it, vi } from "vitest";

import {
  briefFixture,
  buildBriefViewHtml,
} from "@web/features/brief/test-utils";

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
}));

function countTitleHeadings(html: string): number {
  const titleHeading = new RegExp(
    `<h1[^>]*>${briefFixture.pr.title}</h1>`,
    "g",
  );
  return html.match(titleHeading)?.length ?? 0;
}

describe("the phone chrome on the server render", () => {
  it("ships the sideways row beside the upright chrome for CSS to pick", async () => {
    const html = await buildBriefViewHtml();

    expect(html).toContain('data-testid="landscape-row"');
    expect(html).toContain("data-landscape-row");
    expect(html).toContain('data-testid="phone-bar"');
    expect(html).toContain("data-phone-bar");
    expect(countTitleHeadings(html)).toBe(2);
  });
});
