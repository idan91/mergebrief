import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import type { ConfigError } from "../contract/errors";
import { ENV_VAR_NAME } from "./consts";
import { renderKey, renderPathSegment } from "./render-key";

/**
 * The instance-config `contextSources:` block: the providers that need a
 * deployment credential. The URL and GitHub Issues providers are built in
 * and take no entry, so an absent block means "built-ins only", never "no
 * providers". Credentials follow `generator.apiKeyEnv`: the file names the
 * env var, never a value.
 */

export const ContextSourceTypes = {
  NOTION: "notion",
  JIRA: "jira",
} as const;
export type ContextSourceType = ValueOf<typeof ContextSourceTypes>;

export const DEFAULT_NOTION_TOKEN_ENV = "NOTION_TOKEN";
export const DEFAULT_JIRA_EMAIL_ENV = "JIRA_EMAIL";
export const DEFAULT_JIRA_TOKEN_ENV = "JIRA_API_TOKEN";

/** A custom domain or two covers a site; the cap bounds the link scan. */
const MAX_JIRA_LINK_HOSTS = 4;
const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** One Jira Cloud site: a single label before `.atlassian.net`. */
export const JIRA_SITE = new RegExp(`^${HOST_LABEL}\\.atlassian\\.net$`, "i");
const HOST_NAME = new RegExp(`^(?:${HOST_LABEL}\\.)+${HOST_LABEL}$`, "i");
const ATLASSIAN_HOST = /(?:^|\.)atlassian\.net$/i;
const MAX_HOST_CHARS = 253;

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

/** Fixed messages: a pasted URL may carry a credential, so no value echoes. */
const JIRA_SITE_MESSAGE =
  "must be the Jira Cloud site host alone, such as acme.atlassian.net: no scheme, path, port or other domain";
const LINK_HOST_MESSAGE = "must be a bare host name: no scheme, path or port";
const LINK_HOST_ATLASSIAN_MESSAGE =
  "must not be an atlassian.net host; list only the site's custom domains";

const LinkHostListSchema = z
  .array(
    z
      .string()
      .max(MAX_HOST_CHARS, LINK_HOST_MESSAGE)
      .regex(HOST_NAME, LINK_HOST_MESSAGE)
      .refine((host) => !ATLASSIAN_HOST.test(host), LINK_HOST_ATLASSIAN_MESSAGE)
      .transform((host) => host.toLowerCase()),
  )
  .max(MAX_JIRA_LINK_HOSTS, `at most ${MAX_JIRA_LINK_HOSTS} hosts`)
  .superRefine((hosts, ctx) => {
    hosts.forEach((host, index) => {
      if (hosts.indexOf(host) !== index) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "lists a host twice",
        });
      }
    });
  });

const JiraContextSourceSchema = z.strictObject({
  type: z.literal(ContextSourceTypes.JIRA),
  site: z
    .string()
    .regex(JIRA_SITE, JIRA_SITE_MESSAGE)
    .transform((site) => site.toLowerCase()),
  /** NAME of the env var holding the token owner's account email; default JIRA_EMAIL. */
  emailEnv: z.string().regex(ENV_VAR_NAME, ENV_VAR_NAME_MESSAGE).optional(),
  /** NAME of the env var holding the API token; default JIRA_API_TOKEN. */
  tokenEnv: z.string().regex(ENV_VAR_NAME, ENV_VAR_NAME_MESSAGE).optional(),
  /** Hosts whose issue links count as this site's, such as a custom domain. */
  linkHosts: LinkHostListSchema.optional(),
});

/** One entry per kind: nothing downstream selects among several, so a second one could only be ignored. */
export const ContextSourcesConfigSchema = z
  .array(
    z.discriminatedUnion("type", [
      NotionContextSourceSchema,
      JiraContextSourceSchema,
    ]),
  )
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
  const path = issue.path.map(renderPathSegment).join(".");
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
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

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
