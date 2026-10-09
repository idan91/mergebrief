import {
  CUSTOM_ATTRIBUTE_NAME_MAX_CHARS,
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
} from "../../types";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type RiskTokensRead,
  type StoredChunkRead,
} from "../types";

const MALFORMED_TOKEN = `Not a kebab-case risk name of at most ${CUSTOM_ATTRIBUTE_NAME_MAX_CHARS} characters`;

function isWellFormedToken(token: string): boolean {
  const fits = token.length <= CUSTOM_ATTRIBUTE_NAME_MAX_CHARS;
  const isWellFormed = fits && CUSTOM_ATTRIBUTE_NAME_PATTERN.test(token);
  return isWellFormed;
}

function makeDrop(path: string): ArtifactIssue {
  return {
    code: ArtifactIssueCodes.DROPPED_FIELD,
    path,
    message: MALFORMED_TOKEN,
  };
}

/**
 * A repo's custom names are unknown at read time, so a token is checked for
 * shape only. A malformed one costs its own badge and note, never the Brief.
 */
export function dropMalformedRiskTokens(
  chunks: readonly StoredChunkRead[],
): RiskTokensRead {
  const dropped: ArtifactIssue[] = [];

  const kept = chunks.map((chunk, position) => {
    const prefix = `chunks.${position}`;
    const riskSurface = chunk.riskSurface.filter((token, index) => {
      const isKept = isWellFormedToken(token);
      if (!isKept) {
        dropped.push(makeDrop(`${prefix}.riskSurface.${index}`));
      }
      return isKept;
    });
    if (chunk.riskNotes === undefined) {
      return { ...chunk, riskSurface };
    }

    const riskNotes = chunk.riskNotes.filter((note, index) => {
      const isKept = isWellFormedToken(note.attr);
      if (!isKept) {
        dropped.push(makeDrop(`${prefix}.riskNotes.${index}`));
      }
      return isKept;
    });
    return { ...chunk, riskSurface, riskNotes };
  });

  return { chunks: kept, dropped };
}
