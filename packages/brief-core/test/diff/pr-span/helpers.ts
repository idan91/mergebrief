import { createHash } from "node:crypto";
import { formatPatch, OMIT_HEADERS, structuredPatch } from "diff";
import type { Result } from "types/utils";
import {
  BlobReadKinds,
  type BlobRead,
  type BlobRef,
  type PrDiffRef,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanSource,
} from "../../../src/diff/pr-span";

const BLOB_ID_LENGTH = 7;
const DEFAULT_MODE = "100644";
const ZERO_BLOB_ID = "0000000";
const DEV_NULL = "/dev/null";

/** Text whose lines are `items`, newline-ended as git stores a file. */
export function makeText(items: readonly string[]): string {
  return `${items.join("\n")}\n`;
}

/** `b1` to `b<count>`: the base file every scenario edits. */
export function makeBaseLines(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `b${index + 1}`);
}

/** `lines` with `inserted` placed after the line reading `after`. */
export function insertAfter(
  lines: readonly string[],
  after: string,
  inserted: readonly string[],
): string[] {
  const at = lines.indexOf(after) + 1;
  return [...lines.slice(0, at), ...inserted, ...lines.slice(at)];
}

export function replaceLine(
  lines: readonly string[],
  from: string,
  to: readonly string[],
): string[] {
  const at = lines.indexOf(from);
  return [...lines.slice(0, at), ...to, ...lines.slice(at + 1)];
}

export function makeBlobId(content: string): string {
  return createHash("sha1")
    .update(content)
    .digest("hex")
    .slice(0, BLOB_ID_LENGTH);
}

export interface FilePatchFixture {
  readonly path: string;
  readonly base: string;
  readonly head: string;
  readonly prePath?: string;
  readonly mode?: string;
  /** The base's mode when the PR changes it. */
  readonly oldMode?: string;
  readonly isAdded?: true;
  readonly isDeleted?: true;
}

function makeFileLines(fixture: FilePatchFixture, prePath: string): string[] {
  const preLine = fixture.isAdded ? DEV_NULL : `a/${prePath}`;
  const postLine = fixture.isDeleted ? DEV_NULL : `b/${fixture.path}`;
  return [`--- ${preLine}`, `+++ ${postLine}`];
}

/** One file's git-style patch from base to head, three lines of context, with an `index` line. */
export function makeFilePatch(fixture: FilePatchFixture): string {
  const prePath = fixture.prePath ?? fixture.path;
  const structured = structuredPatch(
    prePath,
    fixture.path,
    fixture.base,
    fixture.head,
    undefined,
    undefined,
    {
      context: 3,
    },
  );
  const hunks = formatPatch(structured, OMIT_HEADERS).replace(/\n$/, "");
  const mode = fixture.mode ?? DEFAULT_MODE;
  const header = [`diff --git a/${prePath} b/${fixture.path}`];
  if (prePath !== fixture.path) {
    header.push(`rename from ${prePath}`, `rename to ${fixture.path}`);
  }
  const modeChanged = fixture.oldMode !== undefined && fixture.oldMode !== mode;
  if (modeChanged) {
    header.push(`old mode ${fixture.oldMode}`, `new mode ${mode}`);
  }
  if (fixture.isAdded) {
    header.push(`new file mode ${mode}`);
  }
  if (fixture.isDeleted) {
    header.push(`deleted file mode ${mode}`);
  }

  const preId = fixture.isAdded ? ZERO_BLOB_ID : makeBlobId(fixture.base);
  const postId = fixture.isDeleted ? ZERO_BLOB_ID : makeBlobId(fixture.head);
  const headerNamesMode =
    modeChanged || fixture.isAdded === true || fixture.isDeleted === true;
  const indexMode = headerNamesMode ? "" : ` ${mode}`;
  header.push(
    `index ${preId}..${postId}${indexMode}`,
    ...makeFileLines(fixture, prePath),
    hunks,
  );
  return header.join("\n");
}

export function makeDiff(patches: readonly string[]): string {
  return `${patches.join("\n")}\n`;
}

export interface StubSourceFixture {
  /** Keyed `<base>..<head>`. */
  readonly diffs: Readonly<Record<string, Result<string, PrSpanFailure>>>;
  /** Keyed `<ref>:<path>`; a missing key reads absent. */
  readonly blobs?: Readonly<
    Record<string, Result<BlobRead, PrSpanFailure> | string>
  >;
  readonly onFetchBlob?: (blob: BlobRef) => void;
  /** Keyed `<base>..<head>`; a missing key answers a merge base no other pair shares, so no read is a fast-forward unless arranged. */
  readonly mergeBases?: Readonly<Record<string, Result<string, PrSpanFailure>>>;
}

export interface StubSource extends PrSpanSource {
  readonly diffCalls: PrDiffRef[];
  readonly blobCalls: BlobRef[];
  readonly mergeBaseCalls: PrDiffRef[];
}

/** Merge bases for a fast-forward from `prevHead` to `newHead` over one merge base `mergeBase`. */
export function makeFastForwardMergeBases(
  refs: PrSpanRefs,
  mergeBase: string,
): Record<string, Result<string, PrSpanFailure>> {
  return {
    [`${refs.prevBase}..${refs.prevHead}`]: { ok: true, value: mergeBase },
    [`${refs.newBase}..${refs.newHead}`]: { ok: true, value: mergeBase },
    [`${refs.prevHead}..${refs.newHead}`]: { ok: true, value: refs.prevHead },
  };
}

export function stubSource(fixture: StubSourceFixture): StubSource {
  const diffCalls: PrDiffRef[] = [];
  const blobCalls: BlobRef[] = [];
  const mergeBaseCalls: PrDiffRef[] = [];
  return {
    diffCalls,
    blobCalls,
    mergeBaseCalls,
    fetchMergeBase(span) {
      mergeBaseCalls.push(span);
      const key = `${span.base}..${span.head}`;
      const mergeBase = fixture.mergeBases?.[key];
      return Promise.resolve(mergeBase ?? { ok: true, value: `mb:${key}` });
    },
    fetchPrDiff(span) {
      diffCalls.push(span);
      const diff = fixture.diffs[`${span.base}..${span.head}`];
      return Promise.resolve(diff ?? { ok: true, value: "" });
    },
    fetchBlob(blob) {
      blobCalls.push(blob);
      fixture.onFetchBlob?.(blob);
      const read = fixture.blobs?.[`${blob.ref}:${blob.path}`];
      if (typeof read === "string") {
        return Promise.resolve({
          ok: true,
          value: { kind: BlobReadKinds.TEXT, content: read },
        });
      }
      return Promise.resolve(
        read ?? { ok: true, value: { kind: BlobReadKinds.ABSENT } },
      );
    },
  };
}
