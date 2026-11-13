/**
 * Env variables whose setting moved into `mergebrief.config.yaml`, keyed to
 * the config key that holds it now. A variable left set would be ignored in
 * silence while whoever set it believes it holds, so the loaders refuse it.
 */
export const MOVED_GENERATOR_VARIABLES = {
  REVISION_NARRATIVE_ENABLED: "generator.revisionNarrative",
  HUGE_SPAN_RATIO: "generator.hugeSpanRatio",
} as const;

export const MOVED_ATTACHMENT_VARIABLES = {
  MERGEBRIEF_ATTACHMENT_QUOTA_FILES: "attachments.quotaFiles",
  MERGEBRIEF_ATTACHMENT_QUOTA_MB: "attachments.quotaMb",
  MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES: "attachments.quotaWindowMinutes",
  MERGEBRIEF_MEDIA_MAX_MB: "attachments.mediaMaxMb",
} as const;

export const MOVED_RETENTION_VARIABLES = {
  AUDIT_RETENTION_DAYS: "retention.auditDays",
  PR_RETENTION_DAYS: "retention.pullRequestDays",
} as const;

export const MOVED_AUDIT_VARIABLES = {
  AUDIT_PRIVATE_WRITES: "audit.privateWrites",
} as const;

export const MOVED_UPDATE_CHECK_VARIABLES = {
  MERGEBRIEF_UPDATE_CHECK: "updateCheck.enabled",
  MERGEBRIEF_UPDATE_CHECK_URL: "updateCheck.url",
} as const;

export interface MovedVariableOptions {
  /** Refuse the variable when it is set at all, for one whose empty value had a meaning of its own. */
  readonly refusesEmpty?: boolean;
}

/** One issue per moved variable still set. Empty reads as unset, as compose passes it, unless `refusesEmpty`. */
export function listMovedVariables(
  env: Readonly<Record<string, string | undefined>>,
  movedVariables: Readonly<Record<string, string>>,
  options: MovedVariableOptions = {},
): readonly string[] {
  return Object.entries(movedVariables).flatMap(([variable, configKey]) => {
    const value = env[variable];
    const leftover = options.refusesEmpty
      ? value !== undefined
      : (value ?? "").trim() !== "";
    return leftover
      ? [`${variable}: moved to ${configKey} in mergebrief.config.yaml`]
      : [];
  });
}
