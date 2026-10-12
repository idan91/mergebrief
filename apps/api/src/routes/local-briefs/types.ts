import type { LocalBriefKind, LocalBriefSummary } from "contract";
import type { Context } from "hono";
import type { Logger } from "logging";
import type { ValueOf } from "types/utils";
import type { z } from "zod/v4";
import type { AuthRouteDeps } from "../auth/session/types";
import type { AuthzEnv } from "../../access/types";
import type {
  comparisonMarksHeaderSchema,
  revisionChangesHeaderSchema,
} from "./schemas";

export interface LocalBriefsRouteDeps extends AuthRouteDeps {
  /** Absolute: the composition root resolves it. */
  readonly localBriefsDir?: string | undefined;
}

/** The log is the request's own, so it joins per request, not here. */
export interface LocalBriefsHandlerDeps {
  /** Absolute: the composition root resolves it. */
  readonly dir: string;
}

export interface LocalBriefsControllerDeps {
  /** Absolute: the composition root resolves it. */
  readonly dir: string;
  readonly log: Logger;
}

export const LocalBriefsFailureKinds = {
  NOT_FOUND: "not-found",
  UNREADABLE: "unreadable",
} as const;
export type LocalBriefsFailureKind = ValueOf<typeof LocalBriefsFailureKinds>;

/** The cause is logged where it happens and never rides the failure. */
export interface LocalBriefsFailure {
  readonly kind: LocalBriefsFailureKind;
}

export type ComparisonMarksHeader = z.infer<typeof comparisonMarksHeaderSchema>;
export type RevisionChangesHeader = z.infer<typeof revisionChangesHeaderSchema>;

export interface ComparisonMarksEntry extends ComparisonMarksHeader {
  /** The sidecar filename minus its suffix: the marks id a reader asks for. */
  readonly id: string;
}

/** A legacy sidecar is keyed by the id of the brief that owns it. */
export interface RevisionChangesEntry {
  readonly id: string;
  readonly headSha: string;
  readonly prevHeadSha: string;
  readonly prevIndex: number;
}

export interface ComparisonSources {
  readonly summaries: readonly LocalBriefSummary[];
  readonly marks: readonly ComparisonMarksEntry[];
  readonly legacy: readonly RevisionChangesEntry[];
  readonly narrativeIds: ReadonlySet<string>;
}

export interface BriefArtifactFile {
  readonly kind: LocalBriefKind;
  readonly name: string;
  readonly text: string;
}

export type LocalBriefsHandler = (
  c: Context<AuthzEnv>,
) => Response | Promise<Response>;

export interface LocalBriefsHandlers {
  readonly listLocalBriefs: LocalBriefsHandler;
  readonly readLocalBrief: LocalBriefsHandler;
  readonly readLocalBriefDiffs: LocalBriefsHandler;
  readonly readLocalComparisonMarks: LocalBriefsHandler;
  readonly readLocalRevisionNarrative: LocalBriefsHandler;
}
