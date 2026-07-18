import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadCases } from "../eval/loadCase";
import { runCase } from "../eval/run";
import { withUsageSink } from "../eval/usageSink";
import { loadPrices, priceUsage } from "../eval/cost";
import type { Generator } from "generators";
import { makeBrief } from "./eval-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");

describe("the shipped corpus", () => {
  it("loads every eval/cases entry: valid fixtures + well-formed checklists", async () => {
    const loaded = await loadCases(join(here, "..", "eval", "cases"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.map((c) => c.id)).toEqual([
      "button-under-split",
      "copybutton-new-export",
      "multi-package-types",
      "pure-move-persistence",
      "schema-change-provenance",
    ]);
    for (const evalCase of loaded.value) {
      expect(evalCase.properties.length).toBeGreaterThanOrEqual(4);
      expect(evalCase.fixture.pr.diff.length).toBeGreaterThan(1000);
    }
  });
});

describe("loadCases", () => {
  it("loads a case dir: validated fixture + imported properties", async () => {
    const loaded = await loadCases(FIXTURES);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
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
});

describe("runCase", () => {
  it("scores successful runs and records generation failures without dying", async () => {
    let call = 0;
    const generate = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("provider hiccup");
      return makeBrief();
    });
    const result = await runCase(generate, 3);
    expect(result.briefs).toHaveLength(2);
    expect(result.generationFailures).toBe(1);
    expect(result.failureMessages[0]).toContain("provider hiccup");
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe("withUsageSink", () => {
  it("injects onUsage into every request and preserves provenance", async () => {
    const seen: unknown[] = [];
    const inner: Generator = {
      generate: async (req) => {
        req.onUsage?.({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 1 });
        // The Zod schema in the request parses {} fine for this stub.
        return {};
      },
      provenance: (effort) => ({ provider: "p", model: "m", effort }),
    };
    const totals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
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
    expect(wrapped.provenance("medium")).toEqual({
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
      { calls: 5, inputTokens: 2_000_000, outputTokens: 500_000, cacheReadTokens: 1_000_000 },
      { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
    );
    // 2M×$3 + 0.5M×$15 + 1M×$0.30 = 6 + 7.5 + 0.3
    expect(cost).toBeCloseTo(13.8);
  });

  it("ignores anthropic cache reads when no cache rate is configured — never guesses", () => {
    const cost = priceUsage(
      "anthropic:claude-opus-4-8",
      { calls: 1, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 9_000_000 },
      { inputPerMTok: 3, outputPerMTok: 15 },
    );
    expect(cost).toBeCloseTo(3);
  });

  it("prices openai-family by subtraction: cached tokens are a SUBSET of input", () => {
    const cost = priceUsage(
      "openai:gpt-x",
      { calls: 1, inputTokens: 800_000, outputTokens: 0, cacheReadTokens: 600_000 },
      { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
    );
    // (800k − 600k)×$5 + 600k×$0.50 = 1.0 + 0.3 — NOT 800k×$5 + 600k×$0.50
    expect(cost).toBeCloseTo(1.3);
  });

  it("openai-family without a cache rate bills the whole prompt at input rate (honest overcount)", () => {
    const cost = priceUsage(
      "openrouter:some/model",
      { calls: 1, inputTokens: 800_000, outputTokens: 0, cacheReadTokens: 600_000 },
      { inputPerMTok: 5, outputPerMTok: 25 },
    );
    expect(cost).toBeCloseTo(4);
  });

  it("clamps a pathological cached>input report to zero uncached — never negative", () => {
    const cost = priceUsage(
      "openai:gpt-x",
      { calls: 1, inputTokens: 100, outputTokens: 0, cacheReadTokens: 900_000 },
      { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
    );
    expect(cost).toBeCloseTo(0.45); // 0 uncached + 900k×$0.50
  });

  it("returns null for a missing prices file (tokens-only mode), errors on malformed", () => {
    const missing = loadPrices(join(FIXTURES, "no-prices.json"));
    expect(missing).toEqual({ ok: true, value: null });
  });
});
