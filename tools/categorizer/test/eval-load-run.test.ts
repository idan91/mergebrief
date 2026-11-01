import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { loadCases } from "../eval/loadCase";
import { runCase } from "../eval/run";
import { withUsageSink } from "../eval/usageSink";
import { loadPrices, priceUsage } from "../eval/cost";
import type { Generator } from "generators";
import { makeBrief } from "./eval-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");
const SAMPLE_CASE_DIR = join(FIXTURES, "eval-case-sample");
const SAMPLE_FIXTURE = join(SAMPLE_CASE_DIR, "fixture.json");
const GZIP_CASE_ID = "gzipped-sample";
const LARGE_CASE_IDS = ["kit-11161", "react-router-11768", "next-60530"];
const DIFF_HEADER = /^diff --git /m;

/** A cases dir holding the sample case with its fixture gzipped, plus `extra` fields. */
function stubGzippedCase(extra: Record<string, string>): string {
  const casesDir = mkdtempSync(join(tmpdir(), "eval-gzip-case-"));
  const caseDir = join(casesDir, GZIP_CASE_ID);
  mkdirSync(caseDir);
  cpSync(join(SAMPLE_CASE_DIR, "expected.ts"), join(caseDir, "expected.ts"));

  const sample: unknown = JSON.parse(readFileSync(SAMPLE_FIXTURE, "utf8"));
  const fixture = JSON.stringify({ ...(sample as object), ...extra });
  writeFileSync(join(caseDir, "fixture.json.gz"), gzipSync(fixture));

  return casesDir;
}

describe("the shipped case set", () => {
  it("loads every eval/cases entry: valid fixtures + well-formed checklists", async () => {
    const loaded = await loadCases(join(here, "..", "eval", "cases"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.map((c) => c.id)).toEqual([
      "button-under-split",
      "copybutton-new-export",
      "intent-adversarial-ticket",
      "intent-broad-epic",
      "intent-github-primary",
      "intent-legit-demotion",
      "intent-masked-fix",
      "intent-none-no-ticket",
      "intent-precise-ticket",
      "intent-primary-plus-refs",
      "kit-11161",
      "multi-package-types",
      "next-60530",
      "pure-move-persistence",
      "react-router-11768",
      "repo-policy-scoped-attribute",
      "schema-change-provenance",
    ]);
    for (const evalCase of loaded.value) {
      expect(evalCase.properties.length).toBeGreaterThanOrEqual(4);
      expect(evalCase.fixture.pr.diff.length).toBeGreaterThan(1000);
    }
  });

  it("loads each large case with its PR's every file in the diff", async () => {
    const casesDir = join(here, "..", "eval", "cases");
    const withAttributes = new Map<string, boolean>();
    for (const id of LARGE_CASE_IDS) {
      // oxlint-disable-next-line no-await-in-loop -- one large fixture in memory at a time
      const loaded = await loadCases(casesDir, id);
      const fixture = loaded.ok ? loaded.value[0]?.fixture : undefined;
      const headerCount = fixture?.pr.diff.split(DIFF_HEADER).length ?? 0;

      expect(headerCount - 1).toBe(fixture?.pr.meta.files.length);
      withAttributes.set(id, fixture?.gitAttributes !== undefined);
    }

    expect(Object.fromEntries(withAttributes)).toEqual({
      "kit-11161": true,
      "react-router-11768": false,
      "next-60530": true,
    });
  });
});

describe("loadCases", () => {
  it("loads a case dir: validated fixture + imported properties", async () => {
    const loaded = await loadCases(FIXTURES);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value).toHaveLength(1);
    const evalCase = loaded.value[0];
    expect(evalCase?.id).toBe("eval-case-sample");
    expect(evalCase?.fixture.pr.locator.owner).toBe("idan91");
    expect(evalCase?.fixture.commitRange.commitCount).toBe(1);
    expect(evalCase?.properties[0]?.id).toBe("has-at-least-one-group");
    expect(evalCase?.properties[0]?.check(makeBrief())).toBe(true);
  });

  it("filters by case id and reports an unknown id as an error", async () => {
    const hit = await loadCases(FIXTURES, "eval-case-sample");
    expect(hit.ok && hit.value.length === 1).toBe(true);
    const miss = await loadCases(FIXTURES, "no-such-case");
    expect(miss.ok).toBe(false);
  });

  it("loads a gzipped fixture with its gitattributes text", async () => {
    const casesDir = stubGzippedCase({ gitAttributes: "dist/** -diff\n" });
    try {
      const loaded = await loadCases(casesDir);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      const fixture = loaded.value[0]?.fixture;
      expect(fixture?.pr.locator.owner).toBe("idan91");
      expect(fixture?.gitAttributes).toBe("dist/** -diff\n");
    } finally {
      rmSync(casesDir, { recursive: true, force: true });
    }
  });

  it("refuses a case carrying both a plain and a gzipped fixture", async () => {
    const casesDir = stubGzippedCase({});
    try {
      cpSync(SAMPLE_FIXTURE, join(casesDir, GZIP_CASE_ID, "fixture.json"));
      const loaded = await loadCases(casesDir);
      expect(loaded).toEqual({
        ok: false,
        error: `case "${GZIP_CASE_ID}": both fixture.json and fixture.json.gz present`,
      });
    } finally {
      rmSync(casesDir, { recursive: true, force: true });
    }
  });

  it("reports a gzipped fixture that does not decompress", async () => {
    const casesDir = stubGzippedCase({});
    try {
      const gzipped = join(casesDir, GZIP_CASE_ID, "fixture.json.gz");
      writeFileSync(gzipped, "not gzip");
      const loaded = await loadCases(casesDir);
      expect(loaded.ok).toBe(false);
      expect(loaded.ok ? "" : loaded.error).toMatch(
        /unreadable fixture\.json\.gz/,
      );
    } finally {
      rmSync(casesDir, { recursive: true, force: true });
    }
  });
});

describe("runCase", () => {
  it("scores successful runs and records generation failures without dying", async () => {
    let call = 0;
    const generate = vi.fn(async () => {
      call += 1;
      if (call === 2) {
        throw new Error("provider hiccup");
      }
      return makeBrief();
    });
    const result = await runCase(generate, 3);
    expect(result.briefs).toHaveLength(2);
    // Provenance numbering survives the failed run, briefs[1] came from run 3.
    expect(result.runNumbers).toEqual([1, 3]);
    expect(result.generationFailures).toBe(1);
    expect(result.failureMessages[0]).toContain("provider hiccup");
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe("withUsageSink", () => {
  it("injects onUsage into every request and preserves origin", async () => {
    const seen: unknown[] = [];
    const inner: Generator = {
      generate: async (req) => {
        req.onUsage?.({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 1 });
        return req.schema.parse({});
      },
      origin: (effort) => ({ provider: "p", model: "m", effort }),
    };
    const totals = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    };
    const wrapped = withUsageSink(inner, (usage) => {
      totals.calls += 1;
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.cacheReadTokens += usage.cacheReadTokens;
      seen.push(usage);
    });
    const { z } = await import("zod/v4");
    await wrapped.generate({
      schema: z.object({}),
      system: "s",
      user: "u",
      effort: "medium",
      label: "l",
    });
    await wrapped.generate({
      schema: z.object({}),
      system: "s",
      user: "u",
      effort: "medium",
      label: "l",
    });
    expect(totals).toEqual({
      calls: 2,
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: 2,
    });
    expect(wrapped.origin("medium")).toEqual({
      provider: "p",
      model: "m",
      effort: "medium",
    });
  });
});

describe("prices", () => {
  it("prices anthropic additively: input EXCLUDES cache reads", () => {
    const cost = priceUsage(
      "anthropic:claude-opus-4-8",
      {
        calls: 5,
        inputTokens: 2_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 1_000_000,
      },
      { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
    );
    // 2M×$3 + 0.5M×$15 + 1M×$0.30 = 6 + 7.5 + 0.3
    expect(cost).toBeCloseTo(13.8);
  });

  it("ignores anthropic cache reads when no cache rate is configured", () => {
    const cost = priceUsage(
      "anthropic:claude-opus-4-8",
      {
        calls: 1,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 9_000_000,
      },
      { inputPerMTok: 3, outputPerMTok: 15 },
    );
    expect(cost).toBeCloseTo(3);
  });

  it("prices openai-family by subtraction, cached tokens being a subset", () => {
    const cost = priceUsage(
      "openai:gpt-x",
      {
        calls: 1,
        inputTokens: 800_000,
        outputTokens: 0,
        cacheReadTokens: 600_000,
      },
      { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
    );
    // (800k − 600k)×$5 + 600k×$0.50 = 1.0 + 0.3. NOT 800k×$5 + 600k×$0.50
    expect(cost).toBeCloseTo(1.3);
  });

  it("openai-family without a cache rate bills the whole prompt at input", () => {
    const cost = priceUsage(
      "openrouter:some/model",
      {
        calls: 1,
        inputTokens: 800_000,
        outputTokens: 0,
        cacheReadTokens: 600_000,
      },
      { inputPerMTok: 5, outputPerMTok: 25 },
    );
    expect(cost).toBeCloseTo(4);
  });

  it("clamps a pathological cached-over-input report to zero uncached", () => {
    const cost = priceUsage(
      "openai:gpt-x",
      { calls: 1, inputTokens: 100, outputTokens: 0, cacheReadTokens: 900_000 },
      { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
    );
    expect(cost).toBeCloseTo(0.45); // 0 uncached + 900k×$0.50
  });

  it("returns null for a missing prices file and errors on a malformed one", () => {
    const missing = loadPrices(join(FIXTURES, "no-prices.json"));
    expect(missing).toEqual({ ok: true, value: null });

    const dir = mkdtempSync(join(tmpdir(), "eval-prices-"));
    try {
      const path = join(dir, "prices.json");
      writeFileSync(path, JSON.stringify({ "fake:m": { inputPerMTok: "5" } }));
      expect(loadPrices(path)).toEqual({
        ok: false,
        error: `malformed prices file at ${path}`,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
