import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ghPrSource,
  isCommitish,
  parsePrUrl,
  type FetchedPr,
  type PrSource,
  type ReviewComment,
} from "../github";
import {
  categorize,
  categorizeRevisionNarrative,
} from "../generation/categorize";
import {
  createGenerator,
  DEFAULT_CONTEXT_SOURCES,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  type Generator,
} from "generators";
import {
  extractConfigFlag,
  extractContextFlag,
  extractOutFlag,
} from "./config";
import type { Mutable } from "types/utils";
import { describeUnreadPrimary, readContextFile } from "./context-file";
import {
  buildContextQuery,
  fetchContextSnippets,
  type ContextProvider,
  type FetchContextSnippetsOptions,
  type PrimarySnippet,
  type TrackerConfig,
} from "../context";
import {
  createCliContextProviders,
  createCliRootDeps,
  resolveCliTrackerReads,
} from "./context-providers";
import { resolveEffectiveTrackers } from "../context/tracker";
import { readLocalTracker } from "./settings";
import { splitDiffByFile } from "../diff/file-diff";
import { assignBriefIndex, lookupBriefShaByIndex } from "../artifacts/manifest";
import { countChangedLines, type RevisionChanges } from "../diff/revchanges";
import { buildComparisonMarks, writeComparisonMarks } from "../diff/comparison";
import { isHugeSpan, parseHugeSpanRatio } from "../generation/huge-span";
import {
  parseRevisionNarrativeFlag,
  type RevisionNarrativeConfig,
} from "../generation/config";
import {
  commentsName,
  diffsName,
  outName,
  prStem,
  printSummary,
  revChangesName,
  revisionNarrativeName,
} from "../artifacts/output";
import { listReadableTrackers, type TrackerReads } from "../context/trackers";
import type {
  Brief,
  CommitRange,
  Effort,
  RevisionNarrativeSkipped,
} from "../types";

/** Where artifacts land when `--out` is absent: `out` under the invoking cwd. */
const DEFAULT_OUT_DIR = "out";

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
    // no .env file, ANTHROPIC_API_KEY may still be set in the environment
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
  source: PrSource,
  options: GenerateOptions,
): Promise<{
  pr: FetchedPr;
  comments: ReviewComment[];
  commitRange: CommitRange;
}> {
  const locator = parsePrUrl(url);
  // Range SHAs may arrive abbreviated from the CLI; artifacts must be keyed
  // by full SHAs or the FE's exact-equality joins silently never match.
  if (range) {
    const [base, head] = await Promise.all([
      source.resolveFullSha(locator, range.base),
      source.resolveFullSha(locator, range.head),
    ]);
    range = { base, head };
  }
  const meta = await source.fetchPrMetadata(locator);
  const [diff, comments, commitRange] = await Promise.all([
    range
      ? source.fetchCompareDiff(locator, range.base, range.head)
      : source.fetchPrDiff(locator),
    source.fetchReviewComments(locator),
    range
      ? source.fetchCompareCommitCount(locator, range.base, range.head).then(
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
  const contextProviders =
    options.contextProviders ?? createCliContextProviders();
  const query = buildContextQuery({
    title: meta.title,
    body: meta.body,
    branch: meta.headRef ?? "",
    repo: locator,
    trackers: options.trackers ?? [],
    readable: listReadableTrackers(options.reads ?? {}),
  });
  const fetchOptions: Mutable<FetchContextSnippetsOptions> = {
    reads: options.reads,
  };
  if (options.suppliedPrimary !== undefined) {
    fetchOptions.suppliedPrimary = options.suppliedPrimary;
  }
  const context = await fetchContextSnippets(
    query,
    contextProviders,
    log,
    fetchOptions,
  );
  return { pr: { locator, meta, diff, ...context }, comments, commitRange };
}

/** The options `generateAndWrite` reads beyond the PR and its output directory. */
export interface GenerateOptions {
  /** The repo's trackers; absent or empty means ticket keys never match. */
  readonly trackers?: readonly TrackerConfig[] | undefined;
  /** A primary ticket supplied by `--context <file>`; replaces the fetch. */
  readonly suppliedPrimary?: PrimarySnippet | undefined;
  /** The providers the composition root built; absent means the CLI defaults. */
  readonly contextProviders?: readonly ContextProvider[] | undefined;
  /** The root's reads by tracker; absent means every primary is reported unread. */
  readonly reads?: TrackerReads | undefined;
  /** The revision-narrative gate the root read; absent means enabled. */
  readonly revisionNarrative?: RevisionNarrativeConfig | undefined;
  /** The huge-span ratio the root read; absent means the default. */
  readonly hugeSpanRatio?: number | undefined;
}

/**
 * Generate one brief and write its artifacts under `outDir`: the diff and
 * metadata fetch, the model call, and the brief, diffs and comments sidecars.
 * This is the shared engine body for the CLI and any other front door, so a
 * caller supplies nothing beyond the PR except where to write.
 */
export async function generateAndWrite(
  outDir: string,
  url: string,
  range: Range | undefined,
  generator: Generator,
  log: (msg: string) => void,
  effort?: Effort,
  source: PrSource = ghPrSource,
  options: GenerateOptions = {},
): Promise<Brief> {
  log(
    range
      ? `fetching compare ${range.base.slice(0, 8)}..${range.head.slice(0, 8)} + metadata…`
      : "fetching diff + metadata…",
  );
  const { pr, comments, commitRange } = await buildInputs(
    url,
    range,
    log,
    source,
    options,
  );

  const stem = prStem(
    `${pr.locator.owner}/${pr.locator.repo}`,
    pr.locator.number,
  );
  const index = await assignBriefIndex(outDir, stem, commitRange.head);
  log(
    `brief _${index}; ${pr.meta.files.length} files, ${pr.links.length} linked refs, ${comments.length} comments; categorizing…`,
  );

  const brief = await categorize(
    pr,
    index,
    commitRange,
    generator,
    log,
    undefined,
    effort,
  );

  // An unread primary is surfaced, never silent; the brief still lands.
  const primaryTicket = brief.intentCheck?.primaryTicket;
  if (primaryTicket?.status === "unread") {
    log(describeUnreadPrimary(primaryTicket));
  }

  const briefFile = join(outDir, outName(brief));
  await writeFile(briefFile, `${JSON.stringify(brief, null, 2)}\n`);

  // Per-file diffs sidecar, so a UI can show the actual code for each chunk.
  const diffsFile = join(outDir, diffsName(brief));
  const fileDiffs = splitDiffByFile(pr.diff);
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);

  // Review comments sidecar (display data, +outdated).
  const commentsFile = join(outDir, commentsName(brief));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);

  log(`wrote ${briefFile}`);
  log(`wrote ${diffsFile} (${fileDiffs.length} files)`);
  log(`wrote ${commentsFile} (${comments.length} comments)`);

  // Comparison marks + revision narrative, absent on the first brief (no
  // previous head). Marks use the same three-dot compare diff as the delta.
  if (index > 1) {
    const prevHeadSha = await lookupBriefShaByIndex(outDir, stem, index - 1);
    if (prevHeadSha) {
      const revDiff = await source.fetchCompareDiff(
        pr.locator,
        prevHeadSha,
        commitRange.head,
      );

      // Never caught: a marks failure means comparison data is unavailable and
      // must surface loudly, unlike a narrative failure below.
      const marks = buildComparisonMarks(
        commitRange.head,
        prevHeadSha,
        "previous-brief",
        index - 1,
        revDiff,
      );
      await writeComparisonMarks(outDir, stem, marks, log);

      // Back-compat alias kept while the FE migrates off `.revchanges.json`.
      // Derived from the marks above, the diff is never scanned twice.
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
        revisionNarrative: options.revisionNarrative,
        hugeSpanRatio: options.hugeSpanRatio,
      });
    }
  }
  return brief;
}

/**
 * Generate and write the revision narrative for a non-first brief, or a skip
 * stub when config-disabled or the incremental span is huge-span territory.
 * Never throws, a narrative failure must not fail the full brief, whose
 * artifacts are already written by the time this runs.
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
  revisionNarrative?: RevisionNarrativeConfig | undefined;
  hugeSpanRatio?: number | undefined;
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
  const skipStub = (
    skipped: RevisionNarrativeSkipped["skipped"],
  ): RevisionNarrativeSkipped => ({
    artifactKind: "revisionNarrativeSkipped",
    pr: brief.pr,
    prevHeadSha,
    headSha: brief.commitRange.head,
    prevIndex,
    headIndex: brief.index,
    skipped,
  });

  const config = args.revisionNarrative ?? { enabled: true };
  if (!config.enabled) {
    await writeFile(
      narrativeFile,
      `${JSON.stringify(skipStub("disabled by config"), null, 2)}\n`,
    );
    log(
      `revision narrative disabled by config; wrote skip stub ${narrativeFile}`,
    );
    return;
  }

  // Whole-PR denominator from PR metadata (per-file additions+deletions), NOT
  // from `pr.diff`: in range mode the fetched diff covers only the explicit
  // base..head span, which would skew the ratio, the metadata file list is
  // whole-PR regardless of how the brief's diff was fetched.
  const wholePrChangedLines = pr.meta.files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  const hugeSpan = isHugeSpan(
    countChangedLines(incrementalDiff),
    wholePrChangedLines,
    args.hugeSpanRatio,
  );
  if (hugeSpan) {
    await writeFile(
      narrativeFile,
      `${JSON.stringify(skipStub("span too large"), null, 2)}\n`,
    );
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
        primaryTicket: pr.primaryTicket,
        brief,
        marksFiles,
      },
      generator,
      log,
      effort,
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

/** CLI wrapper: generate one brief into `outDir`, tagged log lines. */
async function runOne(
  outDir: string,
  url: string,
  range: Range | undefined,
  generator: Generator,
  effort: Effort | undefined,
  options: GenerateOptions,
): Promise<Brief> {
  const tag = prTag(url);
  const log = (msg: string): void => console.error(`[${tag}] ${msg}`);
  return generateAndWrite(
    outDir,
    url,
    range,
    generator,
    log,
    effort,
    ghPrSource,
    options,
  );
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
  const outFlag = flagged ? extractOutFlag(flagged.rest) : null;
  const contextFlag = outFlag ? extractContextFlag(outFlag.rest) : null;
  const parsed = contextFlag ? parseArgs(contextFlag.rest) : null;
  const outDir = outFlag?.outDir ?? DEFAULT_OUT_DIR;
  if (!flagged || !outFlag || !contextFlag || !parsed) {
    console.error(
      "usage: pnpm categorize [--config <mergebrief.config.yaml>] [--out <dir>] [--context <ticket.json>] <pr-url> [<pr-url> …]\n" +
        "       pnpm categorize [--config <path>] [--out <dir>] <pr-url> <base-sha> <head-sha>   (explicit span)\n" +
        "       --out defaults to `out` under the working directory; point it at\n" +
        "       MERGEBRIEF_OUT_DIR to view the result in the dev brief viewer.\n" +
        "       --context supplies the primary ticket as JSON {url, key?, tracker?, title?, header?, content}.",
    );
    process.exit(1);
  }
  const supplied =
    contextFlag.contextPath === null
      ? null
      : readContextFile(contextFlag.contextPath);
  if (supplied !== null && !supplied.ok) {
    console.error(supplied.error);
    process.exit(1);
  }
  // One file describes one ticket: a batch would stamp it on every PR.
  if (supplied !== null && parsed.urls.length > 1) {
    console.error("--context takes exactly one <pr-url>");
    process.exit(1);
  }

  loadEnv();
  // Explicit --config only (no ambient MERGEBRIEF_CONFIG); absent → the
  // zero-config default. Doubles as the config validator: a bad file refuses.
  const loaded =
    flagged.configPath !== null
      ? loadGeneratorConfigFile(flagged.configPath)
      : {
          ok: true as const,
          value: {
            generator: defaultGeneratorConfig,
            trackers: [],
            contextSources: DEFAULT_CONTEXT_SOURCES,
          },
        };
  if (!loaded.ok) {
    console.error(loaded.error.issues.join("; "));
    process.exit(1);
  }
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: outDir,
  });
  if (!constructed.ok) {
    console.error(
      `${constructed.error.issues.join("; ")} — add it to tools/categorizer/.env (see .env.example).`,
    );
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  // Local-only mode: the working tree's settings.yaml names the tracker.
  const local = readLocalTracker(process.cwd());
  if (local.warning !== undefined) console.error(`warning: ${local.warning}`);
  const trackers = resolveEffectiveTrackers(local, loaded.value.trackers);
  // Same spot, same rule: tracker tokens resolve by env-var NAME here only.
  const suppliedPrimary = supplied?.ok ? supplied.value : undefined;
  const reads = resolveCliTrackerReads(
    suppliedPrimary,
    trackers,
    createCliRootDeps(process.env, loaded.value.contextSources),
  );
  if (!reads.ok) {
    console.error(
      `${reads.error.issues.join("; ")} — add it to tools/categorizer/.env (see .env.example).`,
    );
    process.exit(1);
  }
  const options: GenerateOptions = {
    trackers,
    suppliedPrimary,
    contextProviders: createCliContextProviders(),
    reads: reads.value,
    revisionNarrative: parseRevisionNarrativeFlag(
      process.env["REVISION_NARRATIVE_ENABLED"],
    ),
    hugeSpanRatio: parseHugeSpanRatio(process.env["HUGE_SPAN_RATIO"]),
  };

  // PRs are independent, run them in parallel, sharing one generator so the
  // SDK's connection pool is reused. A single bad URL must not kill the batch.
  const generator = constructed.value;
  const effort = loaded.value.generator.effort;
  const results = await Promise.all(
    parsed.urls.map(
      async (
        url,
      ): Promise<
        { url: string; brief: Brief } | { url: string; error: unknown }
      > => {
        try {
          return {
            url,
            brief: await runOne(
              outDir,
              url,
              parsed.range,
              generator,
              effort,
              options,
            ),
          };
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

// Only run the CLI when this file is the process entry point, `generateAndWrite`
// (and the entry re-exports in ../index.ts) must be importable by other front doors
// (e.g. the web app's server fn) without triggering argv parsing / process.exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
