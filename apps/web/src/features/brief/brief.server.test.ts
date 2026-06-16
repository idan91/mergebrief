import { describe, expect, it } from "vitest";

import { readLocalBrief } from "./brief.server";

describe("readLocalBrief", () => {
  it("hydrates review comments from a delta comments sidecar", async () => {
    const brief = await readLocalBrief("Idan91-components-4-35788079..a01bcf1d");

    expect(brief.artifactKind).toBe("delta");
    expect(brief.reviewComments).toBeDefined();
    const comments = brief.reviewComments ?? [];
    expect(comments.map((comment) => comment.id)).toContain("3419186366");
    expect(comments.find((comment) => comment.id === "3419186366")).toMatchObject({
      file: "src/components/Accordion/Accordion.tsx",
      line: null,
      originalLine: 103,
      body: expect.stringContaining("open-close state typesafe"),
    });
  });
});
