/**
 * Capture one real revision pair for the eval harness:
 * `pnpm capture-pair <pr-url> <prev-head> <head> --out <dir> [--prev-base <sha>] [--base <sha>]`.
 * Reads through `gh` on the caller's auth; never runs a generation. The case
 * author adds `expected.ts` beside the written pair.json.
 */
import { parseArgs } from "node:util";
import { parsePrUrl } from "brief-core";
import {
  buildGhPrSpanSource,
  fetchCommitDate,
  fetchCompareCommitCount,
  fetchPrMetadata,
  fetchReviewCommentsCreatedBy,
  ghPrSource,
  isCommitish,
} from "../src/github";
import {
  capturePair,
  writePairCapture,
  type PairCaptureReads,
  type PairCaptureRequest,
} from "../eval/pair-capture";

const USAGE =
  "usage: pnpm capture-pair <pr-url> <prev-head> <head> --out <dir> [--prev-base <sha>] [--base <sha>]";
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

const CAPTURE_READS: PairCaptureReads = {
  fetchPrMetadata,
  fetchCompareCommitCount,
  fetchReviewCommentsCreatedBy,
  fetchCommitDate,
};

interface CaptureArgs {
  url: string;
  refs: string[];
  out: string;
  prevBase?: string;
  base?: string;
}

function parseCaptureArgs(argv: string[]): CaptureArgs | undefined {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      "prev-base": { type: "string" },
      base: { type: "string" },
    },
  });
  const [url, prevHead, head, extra] = positionals;
  const { out } = values;
  if (url === undefined || prevHead === undefined || head === undefined) {
    return undefined;
  }
  if (out === undefined || extra !== undefined) {
    return undefined;
  }

  const args: CaptureArgs = { url, refs: [prevHead, head], out };
  if (values["prev-base"] !== undefined) {
    args.prevBase = values["prev-base"];
  }
  if (values.base !== undefined) {
    args.base = values.base;
  }
  return args;
}

async function resolveRequest(args: CaptureArgs): Promise<PairCaptureRequest> {
  const locator = parsePrUrl(args.url);
  const given = [...args.refs, args.prevBase, args.base].filter(
    (ref) => ref !== undefined,
  );
  const notSha = given.find((ref) => !isCommitish(ref));
  if (notSha !== undefined) {
    throw new Error(`expected a hex commit SHA; got "${notSha}"`);
  }

  const [prevHead = "", head = ""] = await Promise.all(
    args.refs.map((ref) => ghPrSource.resolveFullSha(locator, ref)),
  );
  if (prevHead === head) {
    throw new Error("the previous head and the head are the same commit");
  }
  const request: PairCaptureRequest = { locator, prevHead, head };
  if (args.prevBase !== undefined) {
    request.prevBase = await ghPrSource.resolveFullSha(locator, args.prevBase);
  }
  if (args.base !== undefined) {
    request.base = await ghPrSource.resolveFullSha(locator, args.base);
  }
  return request;
}

async function main(): Promise<void> {
  const args = parseCaptureArgs(process.argv.slice(2));
  if (args === undefined) {
    console.error(USAGE);
    process.exit(EXIT_USAGE);
  }
  const request = await resolveRequest(args);

  const captured = await capturePair(
    CAPTURE_READS,
    buildGhPrSpanSource(request.locator),
    request,
    new AbortController().signal,
  );
  if (!captured.ok) {
    console.error(captured.error);
    process.exit(EXIT_FAILED);
  }
  const written = writePairCapture(args.out, captured.value);
  if (!written.ok) {
    console.error(written.error);
    process.exit(EXIT_FAILED);
  }
  console.error(`wrote ${written.value}; add expected.ts beside it`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_FAILED);
});
