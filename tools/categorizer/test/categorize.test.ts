import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import { categorize } from "../src/categorize";
import type { GenerateRequest, Generator } from "../src/generator";
import type { Effort, Generation } from "../src/types";
import type { FetchedPr } from "../src/github";

/**
 * Mocked Generator (no API key, no network): parses the fixture through the
 * request's own schema, so a fixture that drifts from the schema fails
 * loudly — same convention as `revision-narrative.test.ts`.
 */
class FakeGenerator implements Generator {
  constructor(private readonly fixture: unknown) {}

  provenance(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }

  async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>> {
    return req.schema.parse(this.fixture);
  }
}

const pr: FetchedPr = {
  locator: { owner: "o", repo: "r", number: 1 },
  meta: {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    sha: "deadbeef00000000",
    baseSha: "base0000000000000",
    commitCount: 1,
    files: [{ path: "src/a.ts", additions: 5, deletions: 0 }],
  },
  diff: "diff --git a/src/a.ts b/src/a.ts\n",
  links: [],
};

const commitRange = { base: "base0000000000000", head: "deadbeef00000000", commitCount: 1 };

const twoGroupBriefGen = {
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "schema group",
      summary: "adds the schema",
      dominantCategory: "schema-change",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
    {
      id: "g2",
      title: "logic group",
      summary: "adds logic on top of the schema",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/schema.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 3, deleted: 0 },
      addedRanges: [{ start: 1, end: 3 }],
      removedRanges: [],
      riskSurface: [],
    },
    {
      id: "c2",
      changeGroupId: "g2",
      file: "src/logic.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [{ concern: "implementation", added: 5, deleted: 0 }],
};

describe("categorize — readingOrder pass-through", () => {
  it("carries a valid readingOrder through untouched", async () => {
    const fixture = {
      ...twoGroupBriefGen,
      readingOrder: [
        { groupId: "g1", why: "establishes the schema the rest builds on" },
        { groupId: "g2", why: "the logic that consumes the new schema" },
      ],
    };
    const brief = await categorize(pr, 1, commitRange, new FakeGenerator(fixture));
    expect(brief.readingOrder).toEqual(fixture.readingOrder);
  });

  it("leaves readingOrder absent when the model omits it", async () => {
    const brief = await categorize(pr, 1, commitRange, new FakeGenerator(twoGroupBriefGen));
    expect(brief.readingOrder).toBeUndefined();
  });

  it("drops an invalid readingOrder (missing group) and warns, keeping the brief valid", async () => {
    const fixture = {
      ...twoGroupBriefGen,
      readingOrder: [{ groupId: "g1", why: "establishes the schema the rest builds on" }],
    };
    const logs: string[] = [];
    const brief = await categorize(pr, 1, commitRange, new FakeGenerator(fixture), (m) =>
      logs.push(m),
    );
    expect(brief.readingOrder).toBeUndefined();
    expect(brief.changeGroups).toHaveLength(2);
    expect(logs.some((l) => l.includes("reading order") && l.includes("g2"))).toBe(true);
  });

  it("drops an invalid readingOrder (duplicate group) and warns", async () => {
    const fixture = {
      ...twoGroupBriefGen,
      readingOrder: [
        { groupId: "g1", why: "establishes the schema the rest builds on" },
        { groupId: "g1", why: "again, apparently" },
      ],
    };
    const logs: string[] = [];
    const brief = await categorize(pr, 1, commitRange, new FakeGenerator(fixture), (m) =>
      logs.push(m),
    );
    expect(brief.readingOrder).toBeUndefined();
    expect(logs.some((l) => l.includes("reading order"))).toBe(true);
  });
});
