import "@tanstack/react-start/server-only";

import { briefErrorCode } from "../utils/briefErrors";
import { getServerLogger } from "../../../server/logger";
import {
  listLocalBriefs,
  readComparisonMarks,
  readLocalBrief,
  readLocalFileDiffs,
  readRevisionChanges,
  readRevisionNarrative,
} from "./brief.server";
import type {
  Brief,
  ComparisonMarks,
  FileDiffPatch,
  LocalBriefSummary,
  RevisionChanges,
  RevisionNarrativeArtifact,
} from "../types";

/**
 * The local-brief server functions' BODIES, each ending at the curation
 * boundary. They live here rather than inline in `brief.functions.ts` because
 * a `createServerFn` wrapper cannot be invoked without the Start server
 * runtime, so an inline handler is untestable, and this boundary must not
 * silently regress. `brief.functions.ts` stays the RPC surface: validators +
 * one-line delegation.
 */

const logger = getServerLogger();

/**
 * A rejection here is SERIALIZED TO THE BROWSER, so nothing raw may escape:
 * the readers already reduce their failures to curated copy, and this is the
 * backstop for anything that doesn't (a Node error from a path nobody
 * mapped, a framework internal). The raw reason is logged server-side and
 * replaced; no `cause` is attached, because TanStack's serializer walks
 * non-enumerable own props, so a cause would ship too.
 */
async function curated<T>(action: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    const code = briefErrorCode(error);
    const raw = error instanceof Error ? error.message : String(error);
    if (raw !== code) {
      // A failure nobody mapped escaped a reader, worth an operator's
      // attention. The raw error rides as a FIELD, never interpolated into
      // `msg`: the logging boundary redacts fields, and `msg` bypasses that.
      logger.warn(`${action}: unmapped read failure`, { err: error });
    }
    // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
    throw new Error(code);
  }
}

export interface BriefHandlers {
  getLocalBrief(briefId: string): Promise<Brief>;
  getLocalBriefs(): Promise<LocalBriefSummary[]>;
  getLocalBriefDiffs(briefId: string): Promise<FileDiffPatch[]>;
  getLocalRevisionChanges(briefId: string): Promise<RevisionChanges | null>;
  getLocalComparisonMarks(id: string): Promise<ComparisonMarks | null>;
  getLocalRevisionNarrative(
    id: string,
  ): Promise<RevisionNarrativeArtifact | null>;
}

export const briefHandlers: BriefHandlers = {
  getLocalBrief: (briefId) =>
    curated("getLocalBrief", () => readLocalBrief(briefId)),
  getLocalBriefs: () => curated("getLocalBriefs", () => listLocalBriefs()),
  getLocalBriefDiffs: (briefId) =>
    curated("getLocalBriefDiffs", () => readLocalFileDiffs(briefId)),
  getLocalRevisionChanges: (briefId) =>
    curated("getLocalRevisionChanges", () => readRevisionChanges(briefId)),
  getLocalComparisonMarks: (id) =>
    curated("getLocalComparisonMarks", () => readComparisonMarks(id)),
  getLocalRevisionNarrative: (id) =>
    curated("getLocalRevisionNarrative", () => readRevisionNarrative(id)),
};
