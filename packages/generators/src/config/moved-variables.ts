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

/** One issue per moved variable still set. Empty reads as unset, as compose passes it. */
export function listMovedVariables(
  env: Readonly<Record<string, string | undefined>>,
  movedVariables: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.entries(movedVariables).flatMap(([variable, configKey]) => {
    const leftover = (env[variable] ?? "").trim() !== "";
    return leftover
      ? [`${variable}: moved to ${configKey} in mergebrief.config.yaml`]
      : [];
  });
}
