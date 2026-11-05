// A scripted pull request with stored revisions, for the tests of which brief a
// command chooses.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OFFLINE_REPO_ID, type ScriptedRoute } from "./offline";

export const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;

export function makeSha(digit: number): string {
  return String(digit).repeat(40);
}

function makeRevision(headIndex: number) {
  return {
    baseSha: makeSha(0),
    headSha: makeSha(headIndex),
    headIndex,
    createdAt: "2026-11-04T00:00:00Z",
    generatedAt: "2026-11-04T00:00:00Z",
    comparisons: {},
  };
}

interface MetaOptions {
  readonly latest: number;
  readonly headBriefStored?: boolean;
  readonly generation?: unknown;
  readonly behind?: boolean;
}

export function makeMetaRoute(options: MetaOptions): ScriptedRoute {
  const {
    latest,
    headBriefStored = true,
    generation = null,
    behind = false,
  } = options;
  const revisions = Array.from({ length: latest }, (_, index) =>
    makeRevision(index + 1),
  );
  const head = headBriefStored ? latest : latest + 1;
  return {
    method: "GET",
    path: PULL_PATH,
    body: JSON.stringify({
      baseSha: makeSha(0),
      headSha: makeSha(head),
      briefAvailable: headBriefStored,
      headBriefStored,
      behind,
      generation,
      comparisons: {},
      revisions,
    }),
  };
}

export function makeSessionRoute(
  headIndex: number,
  body: unknown = {},
): ScriptedRoute {
  return {
    method: "GET",
    path: `${PULL_PATH}/session?base=${makeSha(0)}&head=${makeSha(headIndex)}`,
    body: JSON.stringify(body),
  };
}

/** Revisions 1 to 3 stored, and the head force-pushed back to revision 2's commit. */
export function makeHeadBackMetaRoute(behind = false): ScriptedRoute {
  const route = makeMetaRoute({ latest: 3, behind });
  return {
    ...route,
    body: JSON.stringify({
      ...JSON.parse(route.body ?? "{}"),
      headSha: makeSha(2),
      headBriefStored: false,
      briefAvailable: true,
      generation: { status: "succeeded" },
    }),
  };
}

/** A retarget stores a new revision on the same head, under another base. */
export function makeRetargetedMetaRoute(): ScriptedRoute {
  return {
    method: "GET",
    path: PULL_PATH,
    body: JSON.stringify({
      baseSha: makeSha(8),
      headSha: makeSha(3),
      briefAvailable: true,
      headBriefStored: true,
      behind: false,
      generation: null,
      comparisons: {},
      revisions: [
        makeRevision(1),
        makeRevision(2),
        makeRevision(3),
        { ...makeRevision(3), baseSha: makeSha(8), headIndex: 4 },
      ],
    }),
  };
}

export function makeCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "mb-revisions-"));
}
