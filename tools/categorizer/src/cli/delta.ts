import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildComparisonMarks,
  buildContextQuery,
  categorizeDelta,
  DeltaSkipReasons,
  fetchContextSnippets,
  listReadableTrackers,
  parsePrUrl,
  shapeDeltaSkipped,
  shapeDeltaUnchanged,
  splitDiffByFile,
  toPrimaryTicket,
  writeComparisonMarks,
  type ContextProvider,
  type DeltaSpanRef,
  type FetchContextSnippetsOptions,
} from "brief-core";
import { PrSpanFailureKinds, readPrSpan } from "brief-core/pr-span";
import type {
  DeltaBrief,
  DeltaSkipped,
  DeltaUnchanged,
} from "brief-core/types";
import {
  buildGhPrSpanSource,
  fetchPrMetadata,
  fetchReviewComments,
  resolveFullSha,
} from "../github";
import { readBriefBase } from "./categorize";
import {
  createGenerator,
  DEFAULT_CONTEXT_SOURCES,
  DEFAULT_LINK_FETCH,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  type ContextSourcesConfig,
  type Effort,
  type Generator,
} from "generators";
import { extractConfigFlag, extractContextFlag } from "./config";
import { describeUnreadPrimary, readContextFile } from "./context-file";
import {
  createCliContextProviders,
  createCliRootDeps,
  describeTrackerRefusal,
  resolveCliTrackerReads,
} from "./context-providers";
import {
  resolveEffectiveTrackers,
  type TrackerConfig,
} from "generators/trackers";
import { readLocalTracker } from "./settings";
import { lookupBriefIndex } from "../artifacts/manifest";
import {
  deltaCommentsName,
  deltaDiffsName,
  deltaOutName,
  prStem,
  printDeltaSummary,
} from "../artifacts/output";

const OUT_DIR = "out";

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file, ANTHROPIC_API_KEY may still be set in the environment
  }
}

/** What `generateAndWriteDelta` reads beyond the span, its generator and its log. */
interface DeltaOptions {
  /** The configured effort; absent means the generator's default. */
  readonly effort?: Effort | undefined;
  /** The repo's trackers; absent or empty means ticket keys never match. */
  readonly trackers?: readonly TrackerConfig[] | undefined;
  /** What the context fan-out takes: the root's reads, a supplied primary. */
  readonly fetchOptions?: FetchContextSnippetsOptions | undefined;
  /** The providers the composition root built; absent means the CLI defaults. */
  readonly contextProviders?: readonly ContextProvider[] | undefined;
  /** The instance config's `contextSources:` block, which names the Jira site; absent means none. */
  readonly contextSources?: ContextSourcesConfig | undefined;
}

/**
 * Fetch inputs, write checkpoint comparison marks, generate the delta, and write
 * its artifacts under `outDir`.
 *
 * Marks are written BEFORE the model call, so a failed delta generation still
 * leaves marks on disk and the FE can show highlights with an honest "summary
 * unavailable" state.
 */
export async function generateAndWriteDelta(
  outDir: string,
  url: string,
  baselineSha: string,
  headSha: string,
  generator: Generator,
  log: (msg: string) => void,
  options: DeltaOptions = {},
): Promise<DeltaBrief | DeltaUnchanged | DeltaSkipped> {
  const {
    effort,
    trackers = [],
    fetchOptions = {},
    contextProviders = createCliContextProviders(DEFAULT_LINK_FETCH),
    contextSources = DEFAULT_CONTEXT_SOURCES,
  } = options;
  const locator = parsePrUrl(url);

  // CLI SHAs may arrive abbreviated; artifacts must carry full SHAs or the
  // FE's exact-equality joins (marks -> brief head, delta -> checkpoint
  // marks) silently never match.
  [baselineSha, headSha] = await Promise.all([
    resolveFullSha(locator, baselineSha),
    resolveFullSha(locator, headSha),
  ]);

  log(
    `fetching metadata + revision span ${baselineSha.slice(0, 8)}..${headSha.slice(0, 8)}…`,
  );
  const [meta, comments] = await Promise.all([
    fetchPrMetadata(locator),
    fetchReviewComments(locator),
  ]);
  // Endpoint brief indices (read-only) for the `_b→_h` label, null if unbriefed.
  const stem = prStem(`${locator.owner}/${locator.repo}`, locator.number);
  const [baselineIndex, headIndex] = await Promise.all([
    lookupBriefIndex(outDir, stem, baselineSha),
    lookupBriefIndex(outDir, stem, headSha),
  ]);
  // A briefed checkpoint starts from its own brief's base, else the PR's now.
  const baselineBase =
    baselineIndex === null
      ? undefined
      : await readBriefBase(outDir, stem, baselineIndex, baselineSha, log);
  const refs = {
    prevBase: baselineBase ?? meta.baseSha,
    prevHead: baselineSha,
    newBase: meta.baseSha,
    newHead: headSha,
  };
  const spanRead = await readPrSpan(
    buildGhPrSpanSource(locator),
    refs,
    new AbortController().signal,
  );
  const spanRef = {
    locator,
    meta,
    baselineSha,
    headSha,
    baselineIndex,
    headIndex,
  };
  if (!spanRead.ok) {
    if (spanRead.error.kind === PrSpanFailureKinds.TOO_LARGE) {
      return writeSkippedDelta(outDir, spanRef, log);
    }
    throw new Error(`revision span unread: ${spanRead.error.kind}`);
  }
  const span = spanRead.value;
  const incrementalDiff = span.filteredDiff;
  if (span.isUnchanged) {
    return writeUnchangedDelta(outDir, stem, spanRef, log);
  }
  const query = buildContextQuery({
    title: meta.title,
    body: meta.body,
    branch: meta.headRef ?? "",
    repo: locator,
    trackers,
    readable: listReadableTrackers(fetchOptions.reads ?? {}),
    contextSources,
  });
  const { links, primaryTicket } = await fetchContextSnippets(
    query,
    contextProviders,
    log,
    fetchOptions,
  );
  // Split the incremental diff once: the marks parse and the per-file diffs
  // sidecar below share the same per-file patches.
  const fileDiffs = splitDiffByFile(incrementalDiff);

  await mkdir(outDir, { recursive: true });
  const marks = buildComparisonMarks(
    headSha,
    baselineSha,
    "checkpoint",
    baselineIndex,
    fileDiffs,
  );
  await writeComparisonMarks(outDir, stem, marks, log);

  log(
    `fetched ${links.length} linked refs, ${comments.length} review comments; generating delta…`,
  );
  // An unread primary is surfaced here too; the delta carries no stamp.
  if (primaryTicket?.status === "unread") {
    log(describeUnreadPrimary(toPrimaryTicket(primaryTicket)));
  }

  const delta = await categorizeDelta(
    {
      locator,
      meta,
      baselineSha,
      headSha,
      baselineIndex,
      headIndex,
      incrementalDiff,
      links,
      primaryTicket,
      comments,
    },
    generator,
    log,
    effort,
  );

  const file = join(outDir, deltaOutName(delta));
  await writeFile(file, `${JSON.stringify(delta, null, 2)}\n`);
  const diffsFile = join(outDir, deltaDiffsName(delta));
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);
  // Review comments sidecar (display data, +outdated), matches the brief.
  const commentsFile = join(outDir, deltaCommentsName(delta));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);
  log(`wrote ${file}`);
  log(`wrote ${diffsFile} (${fileDiffs.length} files)`);
  log(`wrote ${commentsFile} (${comments.length} comments)`);
  return delta;
}

/** A span GitHub will not render: the skip record, no marks, as the worker writes it. */
async function writeSkippedDelta(
  outDir: string,
  spanRef: DeltaSpanRef,
  log: (msg: string) => void,
): Promise<DeltaSkipped> {
  await mkdir(outDir, { recursive: true });
  const record = shapeDeltaSkipped(spanRef, DeltaSkipReasons.SPAN_TOO_LARGE);
  const file = join(outDir, deltaOutName(record));
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  log(`span too large for a delta; wrote ${file}, no delta call`);
  return record;
}

/** Zero-file marks and the no-change record: the PR's own change did not move. */
async function writeUnchangedDelta(
  outDir: string,
  stem: string,
  spanRef: DeltaSpanRef,
  log: (msg: string) => void,
): Promise<DeltaUnchanged> {
  await mkdir(outDir, { recursive: true });
  const marks = buildComparisonMarks(
    spanRef.headSha,
    spanRef.baselineSha,
    "checkpoint",
    spanRef.baselineIndex ?? null,
    [],
  );
  await writeComparisonMarks(outDir, stem, marks, log);

  const record = shapeDeltaUnchanged(spanRef);
  const file = join(outDir, deltaOutName(record));
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  log(`span unchanged since the checkpoint; wrote ${file}, no delta call`);
  return record;
}

async function main(): Promise<void> {
  const flagged = extractConfigFlag(process.argv.slice(2));
  const contextFlag = flagged ? extractContextFlag(flagged.rest) : null;
  const [url, baselineSha, headSha] = contextFlag ? contextFlag.rest : [];
  if (!flagged || !contextFlag || !url || !baselineSha || !headSha) {
    console.error(
      "usage: pnpm delta [--config <mergebrief.config.yaml>] [--context <ticket.json>] <pr-url> <baseline-sha> <head-sha>",
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

  loadEnv();
  // Explicit --config only (no ambient MERGEBRIEF_CONFIG); absent → the
  // zero-config default through the registry interface.
  const loaded =
    flagged.configPath !== null
      ? loadGeneratorConfigFile(flagged.configPath)
      : {
          ok: true as const,
          value: {
            generator: defaultGeneratorConfig,
            trackers: [],
            contextSources: DEFAULT_CONTEXT_SOURCES,
            linkFetch: DEFAULT_LINK_FETCH,
          },
        };
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
  const locator = parsePrUrl(url);
  const tag = `${locator.owner}/${locator.repo}#${locator.number}`;
  const log = (msg: string): void => console.error(`[${tag}] ${msg}`);

  // Local-only mode: the working tree's settings.yaml names the tracker.
  const local = readLocalTracker(process.cwd());
  const trackers = resolveEffectiveTrackers(local, loaded.value.trackers);
  // Same spot, same rule: tracker tokens resolve by env-var NAME here only.
  const suppliedPrimary = supplied?.ok ? supplied.value : undefined;
  const reads = resolveCliTrackerReads(
    suppliedPrimary,
    trackers,
    createCliRootDeps(process.env, loaded.value.contextSources),
  );
  if (!reads.ok) {
    console.error(describeTrackerRefusal(reads.error));
    process.exit(1);
  }
  if (local.warning !== undefined) {
    log(`warning: ${local.warning}`);
  }
  const fetchOptions: FetchContextSnippetsOptions =
    suppliedPrimary === undefined ? {} : { suppliedPrimary };

  const delta = await generateAndWriteDelta(
    OUT_DIR,
    url,
    baselineSha,
    headSha,
    constructed.value,
    log,
    {
      effort: loaded.value.generator.effort,
      trackers,
      fetchOptions: { ...fetchOptions, reads: reads.value },
      contextProviders: createCliContextProviders(loaded.value.linkFetch),
      contextSources: loaded.value.contextSources,
    },
  );

  if ("artifactKind" in delta) {
    return;
  }
  console.log("");
  printDeltaSummary(delta);
}

// Only run the CLI when this file is the process entry point: `generateAndWriteDelta`
// must be importable by tests (and other front doors) without triggering argv
// parsing / process.exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
