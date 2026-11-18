// Which brief a read serves: the span the flags name, or the latest revision
// with a finished brief. Reads move a reviewer forward, so a successful read
// updates the record of what this machine has seen and says when that changed.
import { formatDisplayText } from "brief-core/hidden-chars";
import { GenerationStatuses } from "types";
import { CliError, ExitCodes } from "../../exit";
import { readLastSpan, saveLastSpan } from "../../profile/read-revisions";
import type { BriefSpan } from "../../types";
import type { RepoTarget } from "../target";
import { fetchPrMeta, type PrMetaFields, type StoredRevision } from "./pr-meta";
import {
  SpanSelectionKinds,
  type ExplicitSpanSelection,
  type NumberedSpanSelection,
  type SpanFlags,
  type SpanSelection,
} from "./types";
import { findWorkRevision } from "./work-revision";

const SHORT_SHA_LENGTH = 7;
const REVISION_NUMBER = /^[1-9]\d*$/;

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

/** `behind` compares GitHub's head to the newest brief, so it says nothing true about a head on an older one. */
function isHeadPushedBack(meta: PrMetaFields): boolean {
  const newest = meta.revisions?.at(-1);
  const onHead = findHeadRevision(meta);
  return onHead !== undefined && onHead.headIndex !== newest?.headIndex;
}

/** What the newest brief does not cover, if anything. `behind` is the one signal for a push no generation row has seen. */
function describeUncoveredHead(meta: PrMetaFields): string | undefined {
  if (findHeadRevision(meta) === undefined && meta.headSha !== null) {
    return `head ${shortenSha(meta.headSha)} has no brief yet, ${describeHeadGeneration(meta)}`;
  }
  return meta.behind === true && !isHeadPushedBack(meta)
    ? "GitHub reports commits no brief covers yet"
    : undefined;
}

/** The revision the record names; a span no longer on the PR names none. */
function findRecordedRevision(
  { repoId, cache }: RepoTarget,
  prNumber: number,
  revisions: readonly StoredRevision[],
): StoredRevision | undefined {
  const span = readLastSpan(cache, { repoId, prNumber });
  return revisions.find(
    (revision) =>
      revision.baseSha === span?.base && revision.headSha === span?.head,
  );
}

/**
 * Forward only. Looking back at an older revision is not where the reviewer is,
 * and the server freezes a session once a newer one exists, so a head pushed
 * back leaves them on the revision whose session still takes writes.
 */
function recordRevision(
  target: RepoTarget,
  prNumber: number,
  recorded: StoredRevision | undefined,
  revision: StoredRevision,
): void {
  if (recorded === undefined || revision.headIndex > recorded.headIndex) {
    const { repoId, cache } = target;
    saveLastSpan(cache, { repoId, prNumber }, getRevisionSpan(revision));
  }
}

function getRevisionSpan(revision: StoredRevision): BriefSpan {
  return { base: revision.baseSha, head: revision.headSha };
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
    return served.headIndex !== latest.headIndex
      ? [
          `this is revision ${served.headIndex}; revision ${latest.headIndex} is latest`,
        ]
      : [];
  }

  const lines = [
    `revision ${served.headIndex} ${shortenSha(served.baseSha)}..${shortenSha(served.headSha)}`,
  ];
  const uncovered = describeUncoveredHead(meta);
  if (uncovered !== undefined) {
    lines.push(`${uncovered}; serving revision ${served.headIndex}`);
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

  const { client, repoId, io } = target;
  const { slice: meta } = await fetchPrMeta(client, repoId, prNumber);
  const served = pickRevision(selection, meta, prNumber);
  const latest = findLatestRevision(meta) ?? served;

  const workNote = await read(getRevisionSpan(served));

  const previous = findRecordedRevision(target, prNumber, meta.revisions ?? []);
  recordRevision(target, prNumber, previous, served);

  for (const line of buildServedLines({ meta, selection, served, latest })) {
    io.successNotice(formatDisplayText(line));
  }
  const movedToLatest =
    served.headIndex === latest.headIndex &&
    previous !== undefined &&
    served.headIndex > previous.headIndex;
  if (movedToLatest) {
    io.successNotice(
      `revision ${served.headIndex} is now latest (you were on revision ${previous.headIndex}).`,
    );
    const note = workNote ?? buildMovedDefaultNote(prNumber);
    if (note.length > 0) {
      io.successNotice(note);
    }
  }
}

type NamedSpanSelection = ExplicitSpanSelection | NumberedSpanSelection;

/** Flags named the brief, so a write goes there unguarded; the server's 409 still applies. */
async function runNamedWrite(
  target: RepoTarget,
  prNumber: number,
  selection: NamedSpanSelection,
  write: (span: BriefSpan) => Promise<void>,
): Promise<void> {
  if (selection.kind === SpanSelectionKinds.EXPLICIT) {
    await write(selection.span);
    return;
  }

  const { client, repoId, io } = target;
  const { slice: meta } = await fetchPrMeta(client, repoId, prNumber);
  const named = pickRevision(selection, meta, prNumber);
  await write(getRevisionSpan(named));

  const latest = findLatestRevision(meta) ?? named;
  for (const line of buildServedLines({
    meta,
    selection,
    served: named,
    latest,
  })) {
    io.successNotice(formatDisplayText(line));
  }
}

interface WritePlace {
  readonly meta: PrMetaFields;
  readonly latest: StoredRevision;
  readonly recorded: StoredRevision | undefined;
  /** Where the reviewer is: the record, else their work on the server; undefined with neither. */
  readonly place: StoredRevision | undefined;
}

async function readWritePlace(
  target: RepoTarget,
  prNumber: number,
): Promise<WritePlace> {
  const { client, repoId } = target;
  const { slice: meta } = await fetchPrMeta(client, repoId, prNumber);
  const revisions = meta.revisions ?? [];
  const latest = findLatestRevision(meta);
  if (latest === undefined) {
    throw buildNoBriefError(meta, prNumber);
  }

  const recorded = findRecordedRevision(target, prNumber, revisions);
  const place =
    recorded ??
    (await findWorkRevision({ client, repoId, prNumber, revisions, latest }));
  return { meta, latest, recorded, place };
}

function buildWriteLine(
  { meta, latest, place }: WritePlace,
  prNumber: number,
): string | undefined {
  if (place === undefined) {
    return `writing on revision ${latest.headIndex}, the latest; nothing shows you read PR ${prNumber} here`;
  }
  if (place.headIndex > latest.headIndex) {
    return `writing on revision ${place.headIndex}; the head went back to revision ${latest.headIndex}`;
  }
  if (place.headIndex < latest.headIndex) {
    return `writing on revision ${place.headIndex}; revision ${latest.headIndex} is latest. Run \`mergebrief session ${prNumber}\` to move.`;
  }
  const uncovered = describeUncoveredHead(meta);
  return uncovered === undefined
    ? undefined
    : `${uncovered}; writing on revision ${place.headIndex}`;
}

/**
 * A private write stays on the revision the reviewer is on: their line numbers
 * came from it, and carry-over moves the work to a newer one later. A draft
 * written straight to the newer one keeps those numbers with nothing to remap it.
 */
export async function runPrivateWrite(
  target: RepoTarget,
  prNumber: number,
  selection: SpanSelection,
  write: (span: BriefSpan) => Promise<void>,
): Promise<void> {
  if (selection.kind !== SpanSelectionKinds.LATEST) {
    await runNamedWrite(target, prNumber, selection, write);
    return;
  }

  const written = await readWritePlace(target, prNumber);
  const revision = written.place ?? written.latest;
  await write(getRevisionSpan(revision));

  recordRevision(target, prNumber, written.recorded, revision);
  const line = buildWriteLine(written, prNumber);
  if (line !== undefined) {
    target.io.successNotice(formatDisplayText(line));
  }
}

function buildSubmitRefusal(message: string): CliError {
  return new CliError(ExitCodes.SERVER_REJECTED, message);
}

/**
 * `submit` is public and pins one commit, so with no flags it refuses unless
 * the reviewer is on the newest code: posting on anything older takes `--revision`.
 */
export async function runSubmitWrite(
  target: RepoTarget,
  prNumber: number,
  selection: SpanSelection,
  write: (span: BriefSpan) => Promise<void>,
): Promise<void> {
  if (selection.kind !== SpanSelectionKinds.LATEST) {
    await runNamedWrite(target, prNumber, selection, write);
    return;
  }

  const { meta, latest, recorded, place } = await readWritePlace(
    target,
    prNumber,
  );
  if (place === undefined) {
    throw buildSubmitRefusal(
      `no sign you read PR ${prNumber}. Run \`mergebrief session ${prNumber}\` first, or pass --revision <n>`,
    );
  }
  if (isHeadPushedBack(meta)) {
    throw buildSubmitRefusal(
      `the head went back to revision ${latest.headIndex}, so MergeBrief cannot confirm GitHub's head: pass --revision ${place.headIndex} to post on what you read`,
    );
  }
  if (place.headIndex !== latest.headIndex) {
    throw buildSubmitRefusal(
      `revision ${latest.headIndex} is latest and you are on revision ${place.headIndex}: pass --revision ${place.headIndex} to post on what you read, or run \`mergebrief session ${prNumber}\` to move`,
    );
  }
  const uncovered = describeUncoveredHead(meta);
  if (uncovered !== undefined) {
    throw buildSubmitRefusal(
      `${uncovered}: pass --revision ${place.headIndex} to post on what you read, or wait for its brief`,
    );
  }

  await write(getRevisionSpan(place));
  recordRevision(target, prNumber, recorded, place);
}
