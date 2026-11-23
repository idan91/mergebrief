import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./render-key";

/**
 * The instance `audit` block. Writes that reach GitHub and every denial are
 * recorded whatever it says; `privateWrites` covers the writes that stay
 * inside the instance.
 */
export interface AuditSettings {
  readonly privateWrites: boolean;
}

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = { privateWrites: true };

const auditBlockSchema = z.strictObject({
  privateWrites: z.boolean("must be true or false").optional(),
});

/** Parse a raw `audit` root value; a key never echoes a pasted credential. */
export function validateAuditBlock(
  block: unknown,
): Result<AuditSettings, ConfigError> {
  const parsed = auditBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `audit: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        return `audit: ${where}${issue.message}`;
      }),
    );
  }

  return {
    ok: true,
    value: {
      privateWrites:
        parsed.data.privateWrites ?? DEFAULT_AUDIT_SETTINGS.privateWrites,
    },
  };
}
