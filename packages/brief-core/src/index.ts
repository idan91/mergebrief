import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrDiff,
  fetchPrMetadata,
  fetchReviewComments,
  isCommitish,
  parsePrUrl,
  resolveFullSha,
  type FetchedPr,
  type ReviewComment,
} from "./github";
import { categorize, categorizeRevisionNarrative, warnIssues } from "./categorize";
import {
  createGenerator,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  type Generator,
} from "generators";
import { extractConfigFlag } from "./cliConfig";
import { splitDiffByFile } from "./diff";
import { assignBriefIndex, lookupBriefShaByIndex } from "./manifest";
import { countChangedLines, type RevisionChanges } from "./revchanges";
import { buildComparisonMarks, writeComparisonMarks } from "./comparison";
import { isHugeSpan } from "./huge-span";
import { revisionNarrativeConfig } from "./config";
import { validateNarrativeMarksOverlap } from "./validate";
import {
  commentsName,
  diffsName,
  outName,
  prStem,
  printSummary,
  revChangesName,
  revisionNarrativeName,
} from "./output";
import type { Brief, CommitRange, Effort, RevisionNarrativeSkipped } from "./types";

const OUT_DIR = "out";

/** An explicit base..head span for a brief, instead of the whole PR at head. */
export interface Range {
  base: string;
  head: string;
}

/** Short, stable label for log lines: `owner/repo#number`, or the URL if unparseable. */
function prTag(url: string): string {
  try {
    const { owner, repo, number } = parsePrUrl(url);
    return `${owner}/${repo}#${number}`;
  } catch {
    return url;
  }
}

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}

/**
 * Fetch everything a brief needs: metadata, the diff (whole PR, or the given
 * base..head span), review comments, and linked context. The commit range is
 * the whole PR by default (base from metadata, count from `gh pr view`) or the
 * explicit span (count from the compare API) when a range is given.
 */
async function buildInputs(
  url: string,
  range: Range | undefined,
  log: (msg: string) => void,
): Promise<{ pr: FetchedPr; comments: ReviewComment[]; commitRange: CommitRange }> {
  const locator = parsePrUrl(url);
  // Range SHAs may arrive abbreviated from the CLI; artifacts must be keyed
  // by full SHAs or the FE's exact-equality joins silently never match.
  if (range) {
    const [base, head] = await Promise.all([
      resolveFullSha(locator, range.base),
      resolveFullSha(locator, range.head),
    ]);
    range = { base, head };
  }
  const meta = await fetchPrMetadata(locator);
  const [diff, comments, commitRange] = await Promise.all([
    range
      ? fetchCompareDiff(locator, range.base, range.head)
      : fetchPrDiff(locator),
    fetchReviewComments(locator),
    range
      ? fetchCompareCommitCount(locator, range.base, range.head).then(
          (commitCount): CommitRange => ({
            base: range.base,
            head: range.head,
            commitCount,
          }),
        )
      : Promise.resolve<CommitRange>({
          base: meta.baseSha,
          head: meta.sha,
          commitCount: meta.commitCount,
        }),
  ]);
  const links = await fetchLinkedContext(meta.body, log);
  return { pr: { locator, meta, diff, links }, comments, commitRange };
}

/**
 * Generate one brief and write its artifacts (the diff/metadata fetch, the
 * model call, and the brief/diffs/comments sidecars) under `outDir`. The
 * shared engine body for both the CLI and any other front door (e.g. the web
 * app's server fn) — the only thing a caller supplies beyond the PR is where
 * to write.
 */
export async function generateAndWrite(
  outDir: string,
  url: string,
  range: Range | undefined,
  generator: Generator,
  log: (msg: string) => void,
  effort?: Effort,
): Promise<Brief> {
  log(
    range
      ? `fetching compare ${range.base.slice(0, 8)}..${range.head.slice(0, 8)} + metadata…`
      : "fetching diff + metadata…",
  );
  const { pr, comments, commitRange } = await buildInputs(url, range, log);

  const stem = prStem(`${pr.locator.owner}/${pr.locator.repo}`, pr.locator.number);
  const index = await assignBriefIndex(outDir, stem, commitRange.head);
  log(
    `brief _${index}; ${pr.meta.files.length} files, ${pr.links.length} linked refs, ${comments.length} comments; categorizing…`,
  );

  const brief = await categorize(pr, index, commitRange, generator, log, undefined, effort);

  const briefFile = join(outDir, outName(brief));
  await writeFile(briefFile, `${JSON.stringify(brief, null, 2)}\n`);

  // Per-file diffs sidecar, so a UI can show the actual code for each chunk.
  const diffsFile = join(outDir, diffsName(brief));
  const fileDiffs = splitDiffByFile(pr.diff);
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);

  // Review comments sidecar (display data, +outdated) — ADR 0012.
  const commentsFile = join(outDir, commentsName(brief));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);

  log(`wrote ${briefFile}`);
  log(`wrote ${diffsFile} (${fileDiffs.length} files)`);
  log(`wrote ${commentsFile} (${comments.length} comments)`);

  // Comparison marks + Revision narrative (ADR 0021/0024). Absent on the first
  // brief (no previous head). Marks use the same three-dot compare diff as the
  // delta — same documented rebase caveat.
  if (index > 1) {
    const prevHeadSha = await lookupBriefShaByIndex(outDir, stem, index - 1);
    if (prevHeadSha) {
      const revDiff = await fetchCompareDiff(pr.locator, prevHeadSha, commitRange.head);

      // Mechanical comparison marks: always written first, and never caught —
      // per the plan, a marks failure means comparison data is unavailable and
      // must surface loudly (unlike a narrative failure below, which must not
      // fail the full Brief).
      const marks = buildComparisonMarks(
        commitRange.head,
        prevHeadSha,
        "previous-brief",
        index - 1,
        revDiff,
      );
      await writeComparisonMarks(outDir, stem, marks, log);

      // Back-compat alias: identical shape/content to the pre-generalization
      // sidecar, kept while the FE migrates off `.revchanges.json` (ADR 0021).
      // Derived from the marks already parsed above — the diff is never
      // scanned twice.
      const revChanges: RevisionChanges = {
        headSha: commitRange.head,
        prevHeadSha,
        prevIndex: index - 1,
        files: marks.files,
      };
      const revFile = join(outDir, revChangesName(brief));
      await writeFile(revFile, `${JSON.stringify(revChanges, null, 2)}\n`);
      log(`wrote ${revFile} (compat alias)`);

      await generateAndWriteRevisionNarrative({
        outDir,
        pr,
        brief,
        prevHeadSha,
        prevIndex: index - 1,
        incrementalDiff: revDiff,
        marksFiles: marks.files,
        generator,
        log,
        effort,
      });
    }
  }
  return brief;
}

/**
 * Generate and write the Revision narrative for a non-first Brief, or a skip
 * stub when config-disabled or the incremental span is huge-span-fallback
 * territory (ADR 0006 #7 / ADR 0024). Never throws — a narrative failure must
 * not fail the full Brief, whose artifacts are already written by the time
 * this runs.
 */
async function generateAndWriteRevisionNarrative(args: {
  outDir: string;
  pr: FetchedPr;
  brief: Brief;
  prevHeadSha: string;
  prevIndex: number;
  incrementalDiff: string;
  marksFiles: ReturnType<typeof buildComparisonMarks>["files"];
  generator: Generator;
  log: (msg: string) => void;
  effort: Effort | undefined;
}): Promise<void> {
  const {
    outDir,
    pr,
    brief,
    prevHeadSha,
    prevIndex,
    incrementalDiff,
    marksFiles,
    generator,
    log,
    effort,
  } = args;
  const narrativeFile = join(outDir, revisionNarrativeName(brief));
  const skipStub = (skipped: RevisionNarrativeSkipped["skipped"]): RevisionNarrativeSkipped => ({
    artifactKind: "revisionNarrativeSkipped",
    pr: brief.pr,
    prevHeadSha,
    headSha: brief.commitRange.head,
    prevIndex,
    headIndex: brief.index,
    skipped,
  });

  const config = revisionNarrativeConfig();
  if (!config.enabled) {
    await writeFile(narrativeFile, `${JSON.stringify(skipStub("disabled by config"), null, 2)}\n`);
    log(`revision narrative disabled by config; wrote skip stub ${narrativeFile}`);
    return;
  }

  // Whole-PR denominator from PR metadata (per-file additions+deletions), NOT
  // from `pr.diff`: in range mode the fetched diff covers only the explicit
  // base..head span, which would skew the ratio — the metadata file list is
  // whole-PR regardless of how the brief's diff was fetched.
  const wholePrChangedLines = pr.meta.files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  if (isHugeSpan(countChangedLines(incrementalDiff), wholePrChangedLines)) {
    await writeFile(narrativeFile, `${JSON.stringify(skipStub("span too large"), null, 2)}\n`);
    log(`revision span too large; wrote skip stub ${narrativeFile}`);
    return;
  }

  try {
    const narrative = await categorizeRevisionNarrative(
      {
        locator: pr.locator,
        meta: pr.meta,
        prevHeadSha,
        headSha: brief.commitRange.head,
        prevIndex,
        headIndex: brief.index,
        incrementalDiff,
        links: pr.links,
        brief,
      },
      generator,
      log,
      effort,
    );
    warnIssues(
      validateNarrativeMarksOverlap(narrative.chunks, marksFiles),
      log,
      "revision narrative marks overlap",
    );
    await writeFile(narrativeFile, `${JSON.stringify(narrative, null, 2)}\n`);
    log(`wrote ${narrativeFile}`);
  } catch (error) {
    log(
      `⚠ revision narrative generation failed (full Brief unaffected): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** CLI wrapper: generate one brief into the CLI's fixed OUT_DIR, tagged log lines. */
async function runOne(
  url: string,
  range: Range | undefined,
  generator: Generator,
  effort: Effort | undefined,
): Promise<Brief> {
  const tag = prTag(url);
  const log = (msg: string): void => console.error(`[${tag}] ${msg}`);
  return generateAndWrite(OUT_DIR, url, range, generator, log, effort);
}

/**
 * Parse argv into either a single range run (`<url> <base> <head>`, mirroring
 * the delta CLI) or a batch of whole-PR runs (`<url> [<url> …]`). Range mode is
 * detected by the 2nd and 3rd args being commit-ish SHAs.
 */
function parseArgs(
  args: string[],
): { urls: string[]; range: Range | undefined } | null {
  if (args.length === 0) return null;
  const [url, maybeBase, maybeHead] = args;
  if (
    args.length === 3 &&
    url &&
    maybeBase &&
    maybeHead &&
    isCommitish(maybeBase) &&
    isCommitish(maybeHead)
  ) {
    return { urls: [url], range: { base: maybeBase, head: maybeHead } };
  }
  return { urls: args, range: undefined };
}

async function main(): Promise<void> {
  const flagged = extractConfigFlag(process.argv.slice(2));
  const parsed = flagged ? parseArgs(flagged.rest) : null;
  if (!flagged || !parsed) {
    console.error(
      "usage: pnpm categorize [--config <mergebrief.config.yaml>] <pr-url> [<pr-url> …]\n" +
        "       pnpm categorize [--config <path>] <pr-url> <base-sha> <head-sha>   (explicit span)",
    );
    process.exit(1);
  }

  loadEnv();
  // Explicit --config only (no ambient MERGEBRIEF_CONFIG here); absent →
  // zero-config default (anthropic + ANTHROPIC_API_KEY + Opus 4.8). This
  // path doubles as the fast config validator: a bad file refuses loudly.
  const loaded =
    flagged.configPath !== null
      ? loadGeneratorConfigFile(flagged.configPath)
      : { ok: true as const, value: { generator: defaultGeneratorConfig } };
  if (!loaded.ok) {
    console.error(loaded.error.issues.join("; "));
    process.exit(1);
  }
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: OUT_DIR,
  });
  if (!constructed.ok) {
    console.error(
      `${constructed.error.issues.join("; ")} — add it to tools/categorizer/.env (see .env.example).`,
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // PRs are independent — run them in parallel, sharing one generator so the
  // SDK's connection pool is reused. A single bad URL must not kill the batch.
  const generator = constructed.value;
  const effort = loaded.value.generator.effort;
  const results = await Promise.all(
    parsed.urls.map(
      async (
        url,
      ): Promise<{ url: string; brief: Brief } | { url: string; error: unknown }> => {
        try {
          return { url, brief: await runOne(url, parsed.range, generator, effort) };
        } catch (error) {
          return { url, error };
        }
      },
    ),
  );

  let failures = 0;
  for (const result of results) {
    if ("error" in result) {
      failures++;
      const { error } = result;
      console.error(
        `\n✗ ${result.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    console.log("");
    printSummary(result.brief);
  }

  if (failures > 0) process.exit(1);
}

// Only run the CLI when this file is the process entry point — `generateAndWrite`
// (and the other exports in ./lib.js) must be importable by other front doors
// (e.g. the web app's server fn) without triggering argv parsing / process.exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
