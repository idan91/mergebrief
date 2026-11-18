import { PrStates } from "types/pull-requests";
import { describe, expect, it } from "vitest";
import { buildStaticLifecycle } from "../src/cli/lifecycle";
import { writeIngestReport } from "../src/cli/report";
import { buildTargetContext } from "../src/cli/scope";
import type { IngestSummary } from "../src/ingest";

const EMPTY_SUMMARY: IngestSummary = {
  briefs: 0,
  narratives: 0,
  marks: 0,
  deltas: 0,
  skipped: [],
  unmapped: [],
};

describe("buildTargetContext", () => {
  it("reads a user target as the url-box owner world", () => {
    expect(buildTargetContext("user:4242")).toEqual({ ownerUserId: 4242n });
  });

  it("reads an installation target as the tenant world", () => {
    expect(buildTargetContext("installation:99")).toEqual({
      installationId: 99n,
    });
  });

  it.each(["nobody:1", "user:0", "user:", "1234"])(
    "refuses %s rather than guessing a scope",
    (target) => {
      expect(() => buildTargetContext(target)).toThrow(/unusable --target/);
    },
  );
});

describe("buildStaticLifecycle", () => {
  it("leaves an open PR with no closure stamps", () => {
    expect(buildStaticLifecycle("open")).toEqual({ state: PrStates.OPEN });
  });

  it("stamps a merged PR with its close time", () => {
    const lifecycle = buildStaticLifecycle("merged");
    expect(lifecycle.state).toBe(PrStates.MERGED);
    expect(lifecycle).toMatchObject({ closedAt: expect.any(Date) });
  });
});

describe("writeIngestReport", () => {
  it("names every unmapped brief, the failure the tool exists to catch", () => {
    const lines: string[] = [];
    writeIngestReport(
      { ...EMPTY_SUMMARY, briefs: 2, unmapped: ["old.brief.json"] },
      (line) => lines.push(line),
    );
    expect(lines.join("")).toContain(
      "UNMAPPED brief (NOT ingested): old.brief.json",
    );
  });

  it("names every skipped file and counts each family", () => {
    const lines: string[] = [];
    writeIngestReport(
      {
        briefs: 3,
        narratives: 2,
        marks: 1,
        deltas: 4,
        skipped: ["notes.txt"],
        unmapped: [],
      },
      (line) => lines.push(line),
    );
    const report = lines.join("");
    expect(report).toContain(
      "ingested: 3 briefs, 2 narratives, 1 marks, 4 deltas; skipped 1 file(s)",
    );
    expect(report).toContain("skipped: notes.txt");
  });
});
