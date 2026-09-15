import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchCompareDiff,
  fetchPrMetadata,
  fetchReviewComments,
  parsePrUrl,
  resolveFullSha,
} from "../github";
import { categorizeDelta } from "../generation/categorize";
import {
  createGenerator,
  DEFAULT_CONTEXT_SOURCES,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  type Generator,
} from "generators";
import { extractConfigFlag, extractContextFlag } from "./config";
import { describeUnreadPrimary, readContextFile } from "./context-file";
import {
  buildContextQuery,
  fetchContextSnippets,
  toPrimaryTicket,
  type ContextProvider,
  type FetchContextSnippetsOptions,
  type TrackerConfig,
} from "../context";
import { listReadableTrackers } from "../context/trackers";
import {
  createCliContextProviders,
  createCliRootDeps,
  resolveCliTrackerReads,
} from "./context-providers";
import { resolveEffectiveTrackers } from "../context/tracker";
import { readLocalTracker } from "./settings";
import { splitDiffByFile } from "../diff/diff";
import { lookupBriefIndex } from "../artifacts/manifest";
import { buildComparisonMarks, writeComparisonMarks } from "../diff/comparison";
import {
  deltaCommentsName,
  deltaDiffsName,
  deltaOutName,
  prStem,
  printDeltaSummary,
} from "../artifacts/output";
import type { DeltaBrief, Effort } from "../types";

const OUT_DIR = "out";

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
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
  effort?: Effort,
  trackers: readonly TrackerConfig[] = [],
  fetchOptions: FetchContextSnippetsOptions = {},
  contextProviders: readonly ContextProvider[] = createCliContextProviders(),
): Promise<DeltaBrief> {
  const locator = parsePrUrl(url);

  // CLI SHAs may arrive abbreviated; artifacts must carry full SHAs or the
  // FE's exact-equality joins (marks -> brief head, delta -> checkpoint
  // marks) silently never match.
  [baselineSha, headSha] = await Promise.all([
    resolveFullSha(locator, baselineSha),
    resolveFullSha(locator, headSha),
  ]);

  log(
    `fetching metadata + compare ${baselineSha.slice(0, 8)}..${headSha.slice(0, 8)}…`,
  );
  const [meta, incrementalDiff, comments] = await Promise.all([
    fetchPrMetadata(locator),
    fetchCompareDiff(locator, baselineSha, headSha),
    fetchReviewComments(locator),
  ]);
  const query = buildContextQuery({
    title: meta.title,
    body: meta.body,
    branch: meta.headRef ?? "",
    repo: locator,
    trackers,
    readable: listReadableTrackers(fetchOptions.reads ?? {}),
  });
  const { links, primaryTicket } = await fetchContextSnippets(
    query,
    contextProviders,
    log,
    fetchOptions,
  );
  // Endpoint brief indices (read-only) for the `_b→_h` label — null if unbriefed.
  const stem = prStem(`${locator.owner}/${locator.repo}`, locator.number);
  const [baselineIndex, headIndex] = await Promise.all([
    lookupBriefIndex(outDir, stem, baselineSha),
    lookupBriefIndex(outDir, stem, headSha),
  ]);

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
  // Review comments sidecar (display data, +outdated) — matches the brief.
  const commentsFile = join(outDir, deltaCommentsName(delta));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);
  log(`wrote ${file}`);
  log(`wrote ${diffsFile} (${fileDiffs.length} files)`);
  log(`wrote ${commentsFile} (${comments.length} comments)`);
  return delta;
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
    console.error(reads.error.issues.join("; "));
    process.exit(1);
  }
  if (local.warning !== undefined) log(`warning: ${local.warning}`);
  const fetchOptions: FetchContextSnippetsOptions =
    suppliedPrimary === undefined ? {} : { suppliedPrimary };

  const delta = await generateAndWriteDelta(
    OUT_DIR,
    url,
    baselineSha,
    headSha,
    constructed.value,
    log,
    loaded.value.generator.effort,
    trackers,
    { ...fetchOptions, reads: reads.value },
    createCliContextProviders(),
  );

  console.log("");
  printDeltaSummary(delta);
}

// Only run the CLI when this file is the process entry point — `generateAndWriteDelta`
// must be importable by tests (and other front doors) without triggering argv
// parsing / process.exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
