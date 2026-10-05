import type { Brief } from "brief-core";
import type { ArtifactIssue } from "brief-core/artifact";
import type { Logger } from "logging";
import type { GenerationKind } from "persistence";
import type { Result } from "types/utils";
import type { AllowedRiskNames } from "../types";

type RiskBearingChunk = Pick<
  Brief["chunks"][number],
  "id" | "riskSurface" | "riskNotes"
>;

/**
 * The names a Brief's write check accepts: this run's custom names plus every
 * risk token on a carried chunk. A carried chunk keeps the names that were
 * valid when it was generated, which the repo may have renamed or removed.
 */
export function collectAllowedRiskNames(
  customNames: readonly string[],
  chunks: readonly RiskBearingChunk[],
  carriedChunkIds: readonly string[],
): AllowedRiskNames {
  const carriedIds = new Set(carriedChunkIds);
  const allowed = new Set(customNames);

  for (const chunk of chunks) {
    const isCarried = carriedIds.has(chunk.id);
    if (!isCarried) {
      continue;
    }

    const noteAttributes = (chunk.riskNotes ?? []).map((note) => note.attr);
    for (const token of [...chunk.riskSurface, ...noteAttributes]) {
      allowed.add(token);
    }
  }

  return [...allowed];
}

/**
 * Warn-only: the caller writes the body it generated whatever the check says.
 * Issue messages can name keys taken from the body, so they never ride a line.
 */
export function warnOnFailedCheck(
  result: Result<unknown, ArtifactIssue[]>,
  kind: GenerationKind,
  log: Logger,
): void {
  if (result.ok) {
    return;
  }

  log.warn("generate: artifact failed its write check, written as generated", {
    evt: "artifact.check.fail",
    kind,
    issueCount: result.error.length,
    firstPath: result.error[0]?.path ?? "",
  });
}
