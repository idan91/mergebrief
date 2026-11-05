// Which brief a read serves: the span the flags name, or the latest revision
// with a finished brief. Reads move a reviewer forward, so a successful read
// updates the record of what this machine has seen and says when that changed.
import { formatDisplayText } from "brief-core/hidden-chars";
import { GenerationStatuses } from "types";
import { CliError, ExitCodes } from "../../exit";
import {
  readLastRevision,
  saveLastRevision,
} from "../../profile/read-revisions";
import type { BriefSpan } from "../../types";
import type { RepoTarget } from "../target";
import { fetchPrMeta, type PrMetaFields } from "./pr-meta";
import {
  SpanSelectionKinds,
  type SpanFlags,
  type SpanSelection,
} from "./types";

const SHORT_SHA_LENGTH = 7;
const REVISION_NUMBER = /^[1-9]\d*$/;

type StoredRevision = NonNullable<PrMetaFields["revisions"]>[number];

/** Flags alone, before any network work: a bad combination exits 2 without a request. */
export function parseSpanFlags(flags: SpanFlags): SpanSelection {
  const { base, head, revision } = flags;
  const namesSpan = base !== undefined || head !== undefined;
  if (revision !== undefined && namesSpan) {
    throw new CliError(
      ExitCodes.USAGE,
      "--revision names a brief on its own, so it cannot be combined with --base/--head",
    );
  }

  if (revision !== undefined) {
    if (!REVISION_NUMBER.test(revision)) {
      throw new CliError(
        ExitCodes.USAGE,
        `--revision must be a positive integer, got "${revision}"`,
      );
    }
    return { kind: SpanSelectionKinds.NUMBERED, headIndex: Number(revision) };
  }

  if (!namesSpan) {
    return { kind: SpanSelectionKinds.LATEST };
  }
  if (!base || !head) {
    throw new CliError(
      ExitCodes.USAGE,
      "--base and --head must be given together",
    );
  }
  return { kind: SpanSelectionKinds.EXPLICIT, span: { base, head } };
}

function buildNoBriefError(meta: PrMetaFields, prNumber: number): CliError {
  const status = meta.generation?.status;
  const named = status === undefined ? "" : ` (${status})`;
  return new CliError(
    ExitCodes.NOT_FOUND,
    `no brief generated yet for PR ${prNumber}${named}; \`mergebrief generation ${prNumber}\` shows where its generation stands`,
  );
}

/** A head pushed back to an older commit still has that commit's brief. */
function findHeadRevision(meta: PrMetaFields): StoredRevision | undefined {
  return meta.revisions?.findLast(
    (revision) => revision.headSha === meta.headSha,
  );
}

/** The newest brief for the code the PR holds now, else the newest finished one. */
function findLatestRevision(meta: PrMetaFields): StoredRevision | undefined {
  return findHeadRevision(meta) ?? meta.revisions?.at(-1);
}

function pickRevision(
  selection: SpanSelection,
  meta: PrMetaFields,
  prNumber: number,
): StoredRevision {
  if (selection.kind !== SpanSelectionKinds.NUMBERED) {
    const latest = findLatestRevision(meta);
    if (latest === undefined) {
      throw buildNoBriefError(meta, prNumber);
    }
    return latest;
  }

  const named = meta.revisions?.find(
    (revision) => revision.headIndex === selection.headIndex,
  );
  if (named === undefined) {
    throw new CliError(
      ExitCodes.NOT_FOUND,
      `revision ${selection.headIndex} is not on PR ${prNumber}; \`mergebrief pr ${prNumber} --json\` lists its revisions`,
    );
  }
  return named;
}

function shortenSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function describeHeadGeneration(meta: PrMetaFields): string {
  const generation = meta.generation;
  if (generation === null || generation === undefined) {
    return "no generation has started";
  }

  const { status, errorCode } = generation;
  if (
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING
  ) {
    return "its brief is generating";
  }
  if (status === GenerationStatuses.AWAITING_TRIGGER) {
    return "a collaborator must click Generate in MergeBrief";
  }
  const reason =
    errorCode === null || errorCode === undefined ? "" : `: ${errorCode}`;
  return `generation ${status}${reason}`;
}

function buildMovedDefaultNote(prNumber: number): string {
  return `Run \`mergebrief session ${prNumber}\` to see what carries over and what needs a re-look.`;
}

interface ServedRevisionNotice {
  readonly meta: PrMetaFields;
  readonly selection: SpanSelection;
  readonly served: StoredRevision;
  readonly latest: StoredRevision;
}

function buildServedLines(notice: ServedRevisionNotice): string[] {
  const { meta, selection, served, latest } = notice;
  if (selection.kind === SpanSelectionKinds.NUMBERED) {
    return served.headIndex < latest.headIndex
      ? [
          `this is revision ${served.headIndex}; revision ${latest.headIndex} is latest`,
        ]
      : [];
  }

  const lines = [
    `revision ${served.headIndex} ${shortenSha(served.baseSha)}..${shortenSha(served.headSha)}`,
  ];
  if (findHeadRevision(meta) === undefined && meta.headSha !== null) {
    lines.push(
      `head ${shortenSha(meta.headSha)} has no brief yet, ${describeHeadGeneration(meta)}; serving revision ${served.headIndex}`,
    );
  }
  return lines;
}

/**
 * Run one read on the selected brief. `read` answers what to say about the
 * reviewer's work if this read moves them to a newer revision: empty when they
 * have none, undefined when it cannot tell.
 */
export async function runSpanRead(
  target: RepoTarget,
  prNumber: number,
  selection: SpanSelection,
  read: (span: BriefSpan) => Promise<string | undefined>,
): Promise<void> {
  if (selection.kind === SpanSelectionKinds.EXPLICIT) {
    await read(selection.span);
    return;
  }

  const { client, repoId, io, cache } = target;
  const { slice: meta } = await fetchPrMeta(client, repoId, prNumber);
  const served = pickRevision(selection, meta, prNumber);
  const latest = findLatestRevision(meta) ?? served;

  const workNote = await read({ base: served.baseSha, head: served.headSha });

  const address = { repoId, prNumber };
  const previous = readLastRevision(cache, address);
  const isLatest = served.headIndex === latest.headIndex;
  // Forward only, except that the latest is always where a reader lands: a head
  // pushed back makes an older revision the latest.
  if (isLatest || previous === undefined || served.headIndex > previous) {
    saveLastRevision(cache, address, served.headIndex);
  }

  for (const line of buildServedLines({ meta, selection, served, latest })) {
    io.successNotice(formatDisplayText(line));
  }
  const movedToLatest =
    isLatest && previous !== undefined && served.headIndex !== previous;
  if (movedToLatest) {
    io.successNotice(
      `revision ${served.headIndex} is now latest (you were on revision ${previous}).`,
    );
    const note = workNote ?? buildMovedDefaultNote(prNumber);
    if (note.length > 0) {
      io.successNotice(note);
    }
  }
}
