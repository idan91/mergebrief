import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../../contract/errors";
import { renderKey } from "../readRoot";
import { LinkFetchModes, type LinkFetchPolicy } from "./types";

export const DEFAULT_LINK_FETCH: LinkFetchPolicy = {
  mode: LinkFetchModes.PUBLIC,
  hosts: [],
};

const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const HOST_ISSUE =
  "must be an exact lowercase hostname, no scheme, port, path or wildcard";
const MODE_ISSUE = `must be one of ${Object.values(LinkFetchModes).join(", ")}`;

const linkFetchBlockSchema = z
  .strictObject(
    {
      mode: z
        .enum(LinkFetchModes, { error: MODE_ISSUE })
        .default(LinkFetchModes.PUBLIC),
      hosts: z.array(z.string().regex(HOSTNAME, HOST_ISSUE)).optional(),
    },
    { error: "must be a mapping" },
  )
  .superRefine((block, ctx) => {
    const hostCount = block.hosts?.length ?? 0;
    if (block.mode === LinkFetchModes.ALLOWLIST && hostCount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["hosts"],
        message: "the allowlist mode needs at least one host",
      });
    }
    if (block.mode !== LinkFetchModes.ALLOWLIST && block.hosts !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["hosts"],
        message: "only the allowlist mode takes hosts",
      });
    }
  });

type ZodIssue = z.ZodError["issues"][number];

function describeIssue(issue: ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    return `linkFetch: unrecognized key ${issue.keys.map(renderKey).join(", ")}`;
  }
  const path = issue.path
    .map((segment) =>
      typeof segment === "string" ? renderKey(segment) : String(segment),
    )
    .join(".");
  if (path === "") {
    return `linkFetch: ${issue.message}`;
  }
  return `linkFetch: ${path}: ${issue.message}`;
}

/**
 * Parse a raw `linkFetch` root value. Issues name fields and reasons and
 * never echo a rejected host: raw key text goes through `renderKey`.
 */
export function validateLinkFetchBlock(
  block: unknown,
): Result<LinkFetchPolicy, ConfigError> {
  const parsed = linkFetchBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(parsed.error.issues.map(describeIssue));
  }
  const { mode, hosts = [] } = parsed.data;
  return { ok: true, value: { mode, hosts } };
}
