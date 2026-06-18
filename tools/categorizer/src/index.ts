import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrDiff,
  fetchPrMetadata,
  fetchReviewComments,
  isCommitish,
  parsePrUrl,
  type FetchedPr,
  type ReviewComment,
} from "./github.js";
import { categorize } from "./categorize.js";
import { AnthropicGenerator, type Generator } from "./generator.js";
import { splitDiffByFile } from "./diff.js";
import { assignBriefIndex } from "./manifest.js";
import {
  commentsName,
  diffsName,
  outName,
  prStem,
  printSummary,
} from "./output.js";
import type { Brief, CommitRange } from "./types.js";

const OUT_DIR = "out";

/** An explicit base..head span for a brief, instead of the whole PR at head. */
interface Range {
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

/** Generate one brief and write its artifacts. Returns the brief for printing. */
async function runOne(
  url: string,
  range: Range | undefined,
  generator: Generator,
): Promise<Brief> {
  const tag = prTag(url);
  const log = (msg: string): void => console.error(`[${tag}] ${msg}`);
  log(
    range
      ? `fetching compare ${range.base.slice(0, 8)}..${range.head.slice(0, 8)} + metadata…`
      : "fetching diff + metadata…",
  );
  const { pr, comments, commitRange } = await buildInputs(url, range, log);

  const stem = prStem(`${pr.locator.owner}/${pr.locator.repo}`, pr.locator.number);
  const index = await assignBriefIndex(OUT_DIR, stem, commitRange.head);
  log(
    `brief _${index}; ${pr.meta.files.length} files, ${pr.links.length} linked refs, ${comments.length} comments; categorizing…`,
  );

  const brief = await categorize(pr, index, commitRange, generator, log);

  const briefFile = join(OUT_DIR, outName(brief));
  await writeFile(briefFile, `${JSON.stringify(brief, null, 2)}\n`);

  // Per-file diffs sidecar, so a UI can show the actual code for each chunk.
  const diffsFile = join(OUT_DIR, diffsName(brief));
  const fileDiffs = splitDiffByFile(pr.diff);
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);

  // Review comments sidecar (display data, +outdated) — ADR 0012.
  const commentsFile = join(OUT_DIR, commentsName(brief));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);

  console.error(`\n[${tag}] wrote ${briefFile}`);
  console.error(`[${tag}] wrote ${diffsFile} (${fileDiffs.length} files)`);
  console.error(`[${tag}] wrote ${commentsFile} (${comments.length} comments)`);
  return brief;
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
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(
      "usage: pnpm categorize <pr-url> [<pr-url> …]\n" +
        "       pnpm categorize <pr-url> <base-sha> <head-sha>   (brief over an explicit span)",
    );
    process.exit(1);
  }

  loadEnv();
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "ANTHROPIC_API_KEY not set — add it to tools/categorizer/.env (see .env.example).",
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // PRs are independent — run them in parallel, sharing one generator so the
  // SDK's connection pool is reused. A single bad URL must not kill the batch.
  const generator = new AnthropicGenerator();
  const results = await Promise.all(
    parsed.urls.map(
      async (
        url,
      ): Promise<{ url: string; brief: Brief } | { url: string; error: unknown }> => {
        try {
          return { url, brief: await runOne(url, parsed.range, generator) };
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

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
