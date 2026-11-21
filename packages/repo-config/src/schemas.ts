// Zod schemas for the two versioned YAML files. Everything is `.strict()`:
// an unknown or mistyped key (an `atributes:` typo) must take the invalid
// path, never silently no-op. Byte-size caps are enforced OUTSIDE Zod (see
// validate.ts); these schemas own STRUCTURAL validity only.

import { z } from "zod/v4";
import {
  parseRepoTriggerConditions,
  type TriggerConditionsBlock,
} from "generators/trigger-conditions";
import {
  refineTrackerSettings,
  TrackerConfigSchema,
  TrackerListSchema,
} from "generators/trackers";
import {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS,
  MAX_CUSTOM_ATTRIBUTES,
  MAX_TRUSTED_BOTS,
  TRUSTED_BOT_LOGIN_PATTERN,
  UNSAFE_ATTRIBUTE_NAMES,
} from "./constants";

// --- settings.yaml (v1) -----------------------------------------------------

type BotLogin = Lowercase<string>;

function isLowercaseBotLogin(value: unknown): value is BotLogin {
  const lowercased = typeof value === "string" && value === value.toLowerCase();
  return lowercased;
}

/** GitHub logins are case-insensitive, so the parsed list holds them lowercased. */
const botLoginSchema = z
  .string()
  .regex(TRUSTED_BOT_LOGIN_PATTERN)
  .transform((login) => login.toLowerCase())
  .pipe(z.custom<BotLogin>(isLowercaseBotLogin));

function hasUniqueLogins(logins: readonly BotLogin[]): boolean {
  return new Set(logins).size === logins.length;
}

const trustedBotsSchema = z
  .array(botLoginSchema)
  .max(MAX_TRUSTED_BOTS)
  .refine(hasUniqueLogins, { error: "a trusted bot is listed twice" });

/** The block parses through its owner; each issue it reports becomes one here. */
const triggerConditionsSchema = z
  .unknown()
  .transform((raw, ctx): TriggerConditionsBlock => {
    const parsed = parseRepoTriggerConditions(raw);
    if (!parsed.ok) {
      for (const message of parsed.error.issues) {
        ctx.addIssue({ code: "custom", message });
      }
      return z.NEVER;
    }
    return parsed.value;
  });

/**
 * `settings.yaml` v1. `.strict()` so a typo'd key is rejected, not ignored;
 * `version` must be the literal `1` (an unknown or missing version takes the
 * invalid path). The `tracker:` block names the repo's ticket tracker; ticket
 * keys match only its configured prefix, and an invalid block rejects the
 * whole file like any other key.
 */
export const settingsV1Schema = z
  .object({
    version: z.literal(1),
    entryCommentOnDrafts: z.boolean().default(true),
    tracker: TrackerConfigSchema.optional(),
    trackers: TrackerListSchema.optional(),
    trustedBots: trustedBotsSchema.optional(),
    triggerConditions: triggerConditionsSchema.optional(),
  })
  .strict()
  .superRefine(refineTrackerSettings);

export type RepoSettingsV1 = z.infer<typeof settingsV1Schema>;

// --- policy.yaml (v1) -------------------------------------------------------

/**
 * One custom risk attribute, a flat fact. No tier/severity/weight, and none
 * can sneak in (`.strict()`). `paths` pre-filters chunks before model
 * evaluation; entries are non-empty glob strings.
 */
export const customAttributeSchema = z
  .object({
    criteria: z.string().min(1).max(CRITERIA_MAX_CHARS),
    implication: z.string().min(1).max(IMPLICATION_MAX_CHARS).optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CustomAttribute = z.infer<typeof customAttributeSchema>;

const UNSAFE_ATTRIBUTE_NAME_SET: ReadonlySet<string> = new Set(
  UNSAFE_ATTRIBUTE_NAMES,
);

/**
 * Custom attribute NAME schema: lower-kebab charset + length cap. These names
 * later extend a model json_schema enum per generation, so the charset
 * restriction is a SECURITY CONTROL: anything off-charset is rejected
 * (whole-file invalid), never sanitized.
 */
export const attributeNameSchema = z
  .string()
  .min(1)
  .max(ATTRIBUTE_NAME_MAX_CHARS)
  .regex(ATTRIBUTE_NAME_PATTERN)
  .refine((name) => !UNSAFE_ATTRIBUTE_NAME_SET.has(name), {
    error: "reserved attribute name",
  });

/**
 * A single de-emphasis rule: quiet an attribute's render, optionally scoped to
 * paths. `attribute` existence (built-in non-floor or a surviving custom name)
 * is validated in validate.ts; the schema only owns shape. Floor attributes
 * are rejected at the schema level (below) because that is a whole-file
 * invalidation, not a warn-and-drop.
 */
export const deEmphasisRuleSchema = z
  .object({
    attribute: z.string().min(1),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type DeEmphasisRule = z.infer<typeof deEmphasisRuleSchema>;

const FLOOR_ATTRIBUTE_SET: ReadonlySet<string> = new Set(FLOOR_ATTRIBUTES);

/**
 * `policy.yaml` v1. `.strict()`; `version` literal `1`; `attributes` is a
 * name→definition record (≤ 20 entries, names charset-gated); `deEmphasize`
 * may not name a floor attribute: one that does invalidates the whole file
 * (reject-whole, never a warn-and-drop for floor).
 */
export const policyV1Schema = z
  .object({
    version: z.literal(1),
    attributes: z.record(attributeNameSchema, customAttributeSchema),
    deEmphasize: z.array(deEmphasisRuleSchema).optional(),
  })
  .strict()
  .refine(
    (policy) => Object.keys(policy.attributes).length <= MAX_CUSTOM_ATTRIBUTES,
    {
      error: `at most ${MAX_CUSTOM_ATTRIBUTES} custom attributes allowed`,
      path: ["attributes"],
    },
  )
  .refine(
    (policy) =>
      !(policy.deEmphasize ?? []).some((rule) =>
        FLOOR_ATTRIBUTE_SET.has(rule.attribute),
      ),
    {
      error: "a floor attribute cannot be de-emphasized",
      path: ["deEmphasize"],
    },
  );

export type RepoPolicyV1 = z.infer<typeof policyV1Schema>;
