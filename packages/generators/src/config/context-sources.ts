import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import type { ConfigError } from "../contract/errors";
import { ENV_VAR_NAME } from "./consts";
import { renderKey } from "./readRoot";

/**
 * The instance-config `contextSources:` block: the providers that need a
 * deployment credential. The URL and GitHub Issues providers are built in
 * and take no entry, so an absent block means "built-ins only", never "no
 * providers". Credentials follow `generator.apiKeyEnv`: the file names the
 * env var, never a value.
 */

export const ContextSourceTypes = {
  NOTION: "notion",
} as const;
export type ContextSourceType = ValueOf<typeof ContextSourceTypes>;

export const DEFAULT_NOTION_TOKEN_ENV = "NOTION_TOKEN";

/** A fixed message: a value pasted where a NAME belongs must never echo. */
const ENV_VAR_NAME_MESSAGE =
  "must be an environment variable NAME (UPPERCASE letters, digits, underscores) — never a token value";

export const NotionContextSourceSchema = z.strictObject({
  type: z.literal(ContextSourceTypes.NOTION),
  /** NAME of the env var holding the integration token; default NOTION_TOKEN. */
  tokenEnv: z.string().regex(ENV_VAR_NAME, ENV_VAR_NAME_MESSAGE).optional(),
});
export type NotionContextSourceConfig = z.infer<
  typeof NotionContextSourceSchema
>;

/** One entry per kind: nothing downstream selects among several, so a second one could only be ignored. */
export const ContextSourcesConfigSchema = z
  .array(z.discriminatedUnion("type", [NotionContextSourceSchema]))
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.type)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "type"],
          message: `duplicate entry of type "${entry.type}"; one entry per type`,
        });
      }
      seen.add(entry.type);
    });
  });
export type ContextSourcesConfig = z.infer<typeof ContextSourcesConfigSchema>;

/** Zero-config default: the built-in providers only. */
export const DEFAULT_CONTEXT_SOURCES: ContextSourcesConfig = [];

/** The failed Result every context-source construction path returns. */
export function buildContextSourcesConfigError(issues: readonly string[]): {
  ok: false;
  error: ConfigError;
} {
  return {
    ok: false,
    error: {
      code: "invalid",
      message: "invalid context source configuration",
      issues,
    },
  };
}

const SOURCE_TYPE_TOKEN = /^[a-z][a-z-]{0,19}$/;

type ZodIssue = z.ZodError["issues"][number];

function describeIssue(issue: ZodIssue): string {
  const path = issue.path
    .map((segment) => {
      if (typeof segment === "string") return renderKey(segment);
      return String(segment);
    })
    .join(".");
  const prefix = path.length > 0 ? `contextSources.${path}` : "contextSources";

  if (issue.code === "unrecognized_keys") {
    return `${prefix}: unrecognized key(s): ${issue.keys.map(renderKey).join(", ")}`;
  }
  if (issue.code === "invalid_union") {
    return `${prefix}: unknown type (valid: ${Object.values(ContextSourceTypes).join(", ")})`;
  }
  return `${prefix}: ${issue.message}`;
}

/** Whether a rejected entry's `type` is safe to echo; a pasted secret is not. */
function renderSourceType(entry: unknown): string {
  if (typeof entry !== "object" || entry === null || !("type" in entry)) {
    return "(missing)";
  }
  const type = String(Reflect.get(entry, "type"));
  return SOURCE_TYPE_TOKEN.test(type) ? `"${type}"` : "(redacted)";
}

/** Parse a raw `contextSources` root value; issues name fields, never values. */
export function validateContextSourcesBlock(
  block: unknown,
): Result<ContextSourcesConfig, ConfigError> {
  const parsed = ContextSourcesConfigSchema.safeParse(block);
  if (parsed.success) return { ok: true, value: parsed.data };

  const issues = parsed.error.issues.map((issue) => {
    if (issue.code !== "invalid_union" || !Array.isArray(block)) {
      return describeIssue(issue);
    }
    const index = issue.path[0];
    const entry = typeof index === "number" ? block[index] : undefined;
    return `${describeIssue(issue)}; got ${renderSourceType(entry)}`;
  });
  return buildContextSourcesConfigError(issues);
}
