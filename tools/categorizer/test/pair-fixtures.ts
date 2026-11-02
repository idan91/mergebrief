import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { z } from "zod/v4";
import { readInputFingerprint } from "brief-core";
import type {
  Effort,
  GenerateRequest,
  Generation,
  Generator,
} from "generators";
import { loadPairCases } from "../eval/pairs";

/** Serves canned generation outputs in call order (run1 base, run1 revised, …). */
export class SequenceGenerator implements Generator {
  calls = 0;
  readonly requests: { system: string; user: string; label: string }[] = [];
  constructor(private readonly outputs: unknown[]) {}
  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }
  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    this.requests.push({
      system: req.system,
      user: req.user,
      label: req.label ?? "",
    });
    const output = this.outputs[this.calls];
    this.calls += 1;
    if (output === undefined) {
      throw new Error("sequence exhausted");
    }
    if (output instanceof Error) {
      throw output;
    }
    return req.schema.parse(output);
  }
}

const intentNone = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

export function makeBriefOutput(
  groups: { id: string; title: string; file: string; start?: number }[],
): unknown {
  return {
    summary: "s",
    intentCheck: intentNone,
    changeGroups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      summary: `${g.title} summary`,
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    })),
    chunks: groups.map((g, i) => ({
      id: `c${i + 1}`,
      changeGroupId: g.id,
      file: g.file,
      concern: "implementation",
      role: "core",
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: g.start ?? 1, end: (g.start ?? 1) + 1 }],
      removedRanges: [],
      riskSurface: [],
    })),
    concernView: [
      { concern: "implementation", added: groups.length * 2, deleted: 0 },
    ],
  };
}

export const DIFF_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

export const PREV_HEAD = "a".repeat(40);
export const NEW_HEAD = "b".repeat(40);
const BASE_SHA = "base".padEnd(40, "0");

function makeMeta(sha: string, files: string[]): unknown {
  return {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    sha,
    baseSha: BASE_SHA,
    commitCount: 1,
    files: files.map((path) => ({ path, additions: 2, deletions: 0 })),
  };
}

function makeDiff(files: string[]): string {
  return files
    .map(
      (f) => `diff --git a/${f} b/${f}
--- a/${f}
+++ b/${f}
@@ -1,1 +1,3 @@
 line
+added
+more
`,
    )
    .join("");
}

/** A two-file pair whose push touched only b.ts; `extra` adds or overrides top-level fields. */
export function makePairJson(extra: Record<string, unknown> = {}): unknown {
  return {
    base: {
      pr: {
        locator: { owner: "o", repo: "r", number: 1 },
        meta: makeMeta(PREV_HEAD, ["a.ts", "b.ts"]),
        diff: makeDiff(["a.ts", "b.ts"]),
        links: [],
      },
      commitRange: { base: BASE_SHA, head: PREV_HEAD, commitCount: 1 },
    },
    revised: {
      pr: {
        locator: { owner: "o", repo: "r", number: 1 },
        meta: makeMeta(NEW_HEAD, ["a.ts", "b.ts"]),
        diff: makeDiff(["a.ts", "b.ts"]),
        links: [],
      },
      commitRange: { base: BASE_SHA, head: NEW_HEAD, commitCount: 2 },
    },
    increment: { filteredSpan: DIFF_B, unfilteredSpan: DIFF_B },
    ...extra,
  };
}

/** Write one pair case dir under a fresh root; returns the root to load from. */
export function writePairCase(
  id: string,
  expectedTs: string,
  pairJson: unknown = makePairJson(),
  fileName: "pair.json" | "pair.json.gz" = "pair.json",
): string {
  const root = mkdtempSync(join(tmpdir(), "pair-cases-"));
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(pairJson);
  const bytes = fileName === "pair.json.gz" ? gzipSync(text) : text;
  writeFileSync(join(dir, fileName), bytes);
  writeFileSync(join(dir, "expected.ts"), expectedTs);
  return root;
}

export const EXPECTED_TS = `
export const pairProperties = [
  {
    id: "frozen-survives",
    description: "the untouched group survives byte-identical",
    check: (pair) =>
      JSON.stringify(pair.base.changeGroups[0]) ===
      JSON.stringify(pair.revised.changeGroups.find((g) => g.id === pair.base.changeGroups[0].id)),
  },
];
`;

/** The input fingerprint `makePairJson`'s base inputs give, which a stored base Brief over them carries. */
export async function readBaseInputFingerprint(): Promise<string> {
  const root = writePairCase("fingerprint", EXPECTED_TS);
  const loaded = await loadPairCases(root, "fingerprint");
  const base = loaded.ok ? loaded.value[0]?.fixture.base : undefined;
  if (base === undefined) {
    throw new Error("the plain pair case did not load");
  }
  return readInputFingerprint(base.pr, base.repoContext);
}
