import "@tanstack/react-start/server-only";

import {
  briefErrorDetail,
  clampConfigMessage,
  GenerateErrorMessage,
  isCuratedBriefError,
} from "../utils/briefErrors";
import { getServerLogger } from "../../../server/logger";
import {
  listLocalBriefs,
  readComparisonMarks,
  readLocalBrief,
  readRevisionChanges,
  readRevisionNarrative,
} from "./brief.server";
import {
  generateBriefFromUrl,
  GeneratorConfigurationError,
} from "./generate.server";
import type {
  Brief,
  ComparisonMarks,
  LocalBriefSummary,
  RevisionChanges,
  RevisionNarrativeArtifact,
} from "../types";

/**
 * The local-brief server functions' BODIES, each ending at the curation
 * boundary. They live here rather than inline in `brief.functions.ts` because
 * a `createServerFn` wrapper cannot be invoked without the Start server
 * runtime, so an inline handler is untestable — and this boundary must not
 * silently regress. `brief.functions.ts` stays the RPC surface: validators +
 * one-line delegation.
 */

const logger = getServerLogger();

/**
 * A rejection here is SERIALIZED TO THE BROWSER, so nothing raw may escape:
 * the readers already reduce their failures to curated copy, and this is the
 * backstop for anything that doesn't (a Node error from a path nobody
 * mapped, a framework internal). The raw reason is logged server-side and
 * replaced; no `cause` is attached — TanStack's serializer walks
 * non-enumerable own props, so a cause would ship too.
 */
async function curated<T>(action: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    const detail = briefErrorDetail(error);
    const raw = error instanceof Error ? error.message : String(error);
    if (raw !== detail) {
      // A failure nobody mapped escaped a reader — worth an operator's
      // attention. The raw error rides as a FIELD, never interpolated into
      // `msg`: the logging boundary redacts fields, and `msg` bypasses that.
      logger.warn(`${action}: unmapped read failure`, { err: error });
    }
    // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
    throw new Error(detail);
  }
}

/**
 * The generation boundary. Two classes are deliberately allowed through with
 * their own text:
 *   - the curated user-facing sentences `generate.server` authors, and
 *   - `GeneratorConfigurationError`, whose message is built from ConfigError
 *     issues (env-var NAMES only) — CLAMPED here anyway, because "safe by
 *     construction" is a comment and this is the boundary.
 * Everything else — including anything brief-core throws with the pasted URL
 * reflected in it — is replaced.
 */
async function curatedGeneration(body: () => Promise<string>): Promise<string> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof GeneratorConfigurationError) {
      // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
      throw new Error(clampConfigMessage(error.message));
    }
    const raw = error instanceof Error ? error.message : String(error);
    if (isCuratedBriefError(raw)) throw error;
    logger.warn("generateBrief: unmapped generation failure", { err: error });
    // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
    throw new Error(GenerateErrorMessage.GENERATION_FAILED);
  }
}

export interface BriefHandlers {
  getLocalBrief(briefId: string): Promise<Brief>;
  getLocalBriefs(): Promise<LocalBriefSummary[]>;
  getLocalRevisionChanges(briefId: string): Promise<RevisionChanges | null>;
  getLocalComparisonMarks(id: string): Promise<ComparisonMarks | null>;
  getLocalRevisionNarrative(
    id: string,
  ): Promise<RevisionNarrativeArtifact | null>;
  generateBrief(url: string): Promise<string>;
}

export const briefHandlers: BriefHandlers = {
  getLocalBrief: (briefId) =>
    curated("getLocalBrief", () => readLocalBrief(briefId)),
  getLocalBriefs: () => curated("getLocalBriefs", () => listLocalBriefs()),
  getLocalRevisionChanges: (briefId) =>
    curated("getLocalRevisionChanges", () => readRevisionChanges(briefId)),
  getLocalComparisonMarks: (id) =>
    curated("getLocalComparisonMarks", () => readComparisonMarks(id)),
  getLocalRevisionNarrative: (id) =>
    curated("getLocalRevisionNarrative", () => readRevisionNarrative(id)),
  generateBrief: (url) => curatedGeneration(() => generateBriefFromUrl(url)),
};
