import type { Mutable, Result } from "types/utils";

import { PUBLISH_TOKEN_ENV } from "../../consts";
import type { ExportTokens, ExportTokenUse } from "./types";

/**
 * Where the one publish token goes. Without `authenticatesReads` no read
 * gets it, whatever the environment holds; a use that needs it refuses
 * when it is missing or empty.
 */
export function resolveExportTokens(
  token: string | undefined,
  use: ExportTokenUse,
): Result<ExportTokens, string> {
  const tokenMissing = token === undefined || token.length === 0;
  if (tokenMissing) {
    if (use.pushes) {
      const error = `export without --dry-run publishes and needs ${PUBLISH_TOKEN_ENV} in the environment`;
      return { ok: false, error };
    }
    if (use.authenticatesReads) {
      const error = `--authenticated-reads reads the target repository with ${PUBLISH_TOKEN_ENV}; set it in the environment`;
      return { ok: false, error };
    }
    return { ok: true, value: {} };
  }

  const tokens: Mutable<ExportTokens> = {};
  if (use.pushes) {
    tokens.publish = token;
  }
  if (use.authenticatesReads) {
    tokens.publicRead = token;
  }
  return { ok: true, value: tokens };
}
