import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import type { Result } from "types";
import type { FetchedPr } from "brief-core";
import type { CommitRange } from "brief-core/types";
import type { RepoContext } from "brief-core";
import type { EvalProperty } from "./properties";

/**
 * Case loading (BRIEF-59 decision 5): each `cases/<id>/` dir carries a
 * fully cached `fixture.json` (no GitHub at eval time) and an
 * `expected.ts` exporting the case's property checklist. The fixture is
 * Zod-validated — it crosses a file boundary and hand-edits happen.
 */

const PrFileSchema = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

const FixtureSchema = z.object({
  pr: z.object({
    locator: z.object({
      owner: z.string(),
      repo: z.string(),
      number: z.number().int().positive(),
    }),
    meta: z.object({
      title: z.string(),
      body: z.string(),
      url: z.string(),
      sha: z.string(),
      baseSha: z.string(),
      commitCount: z.number().int().positive(),
      files: z.array(PrFileSchema),
    }),
    diff: z.string().min(1),
    links: z.array(z.object({ url: z.string(), content: z.string() })),
  }),
  commitRange: z.object({
    base: z.string(),
    head: z.string(),
    commitCount: z.number().int().positive(),
  }),
  /** Optional PARSED repo-config shape (`RepoContext`), embedded directly:
   * the harness deliberately skips the `.mergebrief/` file parsers — the
   * fixture snapshots what the generation actually received. */
  repoContext: z
    .object({
      instructions: z
        .object({
          path: z.string(),
          blobSha: z.string(),
          content: z.string(),
        })
        .optional(),
      customAttributes: z.array(
        z.object({
          name: z.string(),
          criteria: z.string(),
          implication: z.string().optional(),
          paths: z.array(z.string()).optional(),
        }),
      ),
    })
    .optional(),
});

export interface EvalFixture {
  pr: FetchedPr;
  commitRange: CommitRange;
  repoContext?: RepoContext;
}

export interface EvalCase {
  id: string;
  dir: string;
  fixture: EvalFixture;
  properties: EvalProperty[];
}

function isEvalProperty(value: unknown): value is EvalProperty {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "description") === "string" &&
    typeof Reflect.get(value, "check") === "function"
  );
}

/** `onlyCase` filters to one id; naming a case that doesn't exist errors. */
export async function loadCases(
  casesDir: string,
  onlyCase?: string,
): Promise<Result<EvalCase[], string>> {
  if (!existsSync(casesDir)) {
    return { ok: false, error: `cases directory not found: ${casesDir}` };
  }
  const ids = readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b));
  const selected =
    onlyCase === undefined ? ids : ids.filter((id) => id === onlyCase);
  if (onlyCase !== undefined && selected.length === 0) {
    return {
      ok: false,
      error: `unknown case "${onlyCase}" — available: ${ids.join(", ") || "(none)"}`,
    };
  }
  const cases: EvalCase[] = [];
  for (const id of selected) {
    const dir = join(casesDir, id);
    // eslint-disable-next-line no-await-in-loop -- sequential: first bad case aborts the load
    const loaded = await loadOne(id, dir);
    if (!loaded.ok) return loaded;
    cases.push(loaded.value);
  }
  return { ok: true, value: cases };
}

async function loadOne(
  id: string,
  dir: string,
): Promise<Result<EvalCase, string>> {
  const fixturePath = join(dir, "fixture.json");
  if (!existsSync(fixturePath)) {
    return { ok: false, error: `case "${id}": missing fixture.json` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `case "${id}": unreadable fixture.json (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
  const parsed = FixtureSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `case "${id}": invalid fixture.json — ${z.prettifyError(parsed.error)}`,
    };
  }
  const expectedPath = join(dir, "expected.ts");
  if (!existsSync(expectedPath)) {
    return { ok: false, error: `case "${id}": missing expected.ts` };
  }
  const module: unknown = await import(pathToFileURL(expectedPath).href);
  const properties =
    typeof module === "object" && module !== null
      ? Reflect.get(module, "properties")
      : undefined;
  if (!Array.isArray(properties) || !properties.every(isEvalProperty)) {
    return {
      ok: false,
      error: `case "${id}": expected.ts must export \`properties: EvalProperty[]\``,
    };
  }
  if (properties.length === 0) {
    // An empty checklist would score as vacuously clean forever.
    return {
      ok: false,
      error: `case "${id}": expected.ts exports no properties`,
    };
  }
  const repoContext = toRepoContext(parsed.data.repoContext);
  return {
    ok: true,
    value: {
      id,
      dir,
      fixture: {
        pr: parsed.data.pr,
        commitRange: parsed.data.commitRange,
        ...(repoContext !== undefined ? { repoContext } : {}),
      },
      properties,
    },
  };
}

/** Zod optionals infer `| undefined`; RepoContext's fields are exact-optional
 * — rebuild with conditional spreads instead of casting past the checker. */
function toRepoContext(
  raw: z.infer<typeof FixtureSchema>["repoContext"],
): RepoContext | undefined {
  if (raw === undefined) return undefined;
  return {
    ...(raw.instructions !== undefined
      ? { instructions: raw.instructions }
      : {}),
    customAttributes: raw.customAttributes.map((attr) => ({
      name: attr.name,
      criteria: attr.criteria,
      ...(attr.implication !== undefined
        ? { implication: attr.implication }
        : {}),
      ...(attr.paths !== undefined ? { paths: attr.paths } : {}),
    })),
  };
}
