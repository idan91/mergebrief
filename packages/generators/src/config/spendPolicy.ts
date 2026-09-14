import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance spend policy: the operator's daily generation cap, parsed out
 * of `mergebrief.config.yaml`'s `spend` block by the same loaders that own
 * `generator` and `drafts`. INSTANCE config only; no key here has a
 * `.mergebrief/` repo-side counterpart and a repo file can never widen it.
 */

/** Unset = uncapped, the zero-config default. */
export interface SpendPolicy {
  /** Generations per repo per UTC day; null = uncapped. */
  readonly dailyGenerationCap: number | null;
  /**
   * Per-repo overrides keyed by `owner/name`, LOWERCASED at parse time (see
   * `capForRepo`); two spellings of one slug refuse the file. A key that
   * names no installed repo is tolerated; the installation set changes
   * without the operator editing this file.
   */
  readonly perRepo: Readonly<Record<string, number>>;
}

export const DEFAULT_SPEND_POLICY: SpendPolicy = {
  dailyGenerationCap: null,
  perRepo: {},
};

/** `owner/name`; one slash, no whitespace. Catches `owner` and URL pastes. */
const REPO_SLUG = /^[^/\s]+\/[^/\s]+$/;

const capSchema = z
  .number()
  .int("must be a whole number")
  .positive("must be greater than 0");

const spendBlockSchema = z.strictObject({
  dailyGenerationCap: capSchema.optional(),
  perRepo: z
    .record(z.string().regex(REPO_SLUG, "must be owner/name"), capSchema)
    .optional(),
});

/**
 * Parse a raw `spend` root value. Same message posture as the sibling
 * blocks: issues name fields and reasons, and any raw key text goes through
 * `renderKey`; a credential pasted as a stray key must not echo.
 */
export function validateSpendBlock(
  block: unknown,
): Result<SpendPolicy, ConfigError> {
  const parsed = spendBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `spend: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path
          .map((segment) =>
            typeof segment === "string" ? renderKey(segment) : String(segment),
          )
          .join(".");
        // Zod reports a failed record KEY as a generic "Invalid key in
        // record", swallowing the slug rule the operator needs to see.
        const message =
          issue.code === "invalid_key" ? "must be owner/name" : issue.message;
        return `spend: ${path.length > 0 ? `${path}: ` : ""}${message}`;
      }),
    );
  }
  // Keys are normalized to lowercase for the case-insensitive lookup, so two
  // spellings of one repo (`Acme/API` + `acme/api`) would collapse with the
  // last one silently winning; an operator who wrote two caps would get one,
  // and not the one they'd predict. Refuse the file instead (the instance
  // config's fail-closed posture: a boot-knowable mistake never boots).
  const perRepo: Record<string, number> = {};
  const collisions: string[] = [];
  for (const [slug, cap] of Object.entries(parsed.data.perRepo ?? {})) {
    const key = slug.toLowerCase();
    if (key in perRepo) {
      collisions.push(key);
      continue;
    }
    perRepo[key] = cap;
  }
  if (collisions.length > 0) {
    return configError(
      // Echoed verbatim, not through `renderKey`: these keys already passed
      // the `owner/name` shape check, so they are not credential-shaped (a
      // pasted key has no slash); and the operator cannot fix a duplicate
      // they aren't shown. `renderKey` would redact every slug (its token
      // grammar has no `/`), making the message useless.
      collisions.map(
        (key) =>
          `spend: perRepo: "${key}" is listed more than once (repo slugs are case-insensitive)`,
      ),
    );
  }
  return {
    ok: true,
    value: {
      dailyGenerationCap: parsed.data.dailyGenerationCap ?? null,
      perRepo,
    },
  };
}

/**
 * The cap in force for one `owner/name` slug: the per-repo override beats the
 * global default, and null means uncapped. Lookup is case-insensitive;
 * GitHub slugs are, and a casing slip silently uncapping a repo is a spend
 * footgun, not a config error worth refusing boot over.
 */
export function capForRepo(
  policy: SpendPolicy,
  repoSlug: string,
): number | null {
  return policy.perRepo[repoSlug.toLowerCase()] ?? policy.dailyGenerationCap;
}
