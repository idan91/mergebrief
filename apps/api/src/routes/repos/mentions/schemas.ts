import { MentionBounds, MentionPatterns } from "contract";
import { MentionTargetKinds, type MentionTarget } from "github";
import { z } from "zod/v4";

export const mentionQuerySchema = z
  .string()
  .max(MentionBounds.QUERY_LENGTH)
  .default("");

const USER_TARGET = new RegExp(`^${MentionPatterns.LOGIN}$`);
const TEAM_TARGET = new RegExp(
  `^(${MentionPatterns.LOGIN})/(${MentionPatterns.TEAM_SLUG})$`,
);

function parseMentionTarget(entry: string): MentionTarget | undefined {
  if (USER_TARGET.test(entry)) {
    return { kind: MentionTargetKinds.USER, login: entry };
  }
  const team = TEAM_TARGET.exec(entry);
  const org = team?.[1];
  const slug = team?.[2];
  const namesTeam = org !== undefined && slug !== undefined;
  if (!namesTeam) {
    return undefined;
  }
  return { kind: MentionTargetKinds.TEAM, org, slug };
}

/**
 * `login,org/slug,...` into targets, deduplicated ignoring case as GitHub
 * does. An empty list is fine; a malformed entry or too many refuses.
 */
export const mentionTargetsSchema = z
  .string()
  .max(MentionBounds.TARGETS_PER_CALL * (MentionBounds.QUERY_LENGTH + 1))
  .default("")
  .transform((raw, ctx) => {
    const entries = raw === "" ? [] : raw.split(",");
    if (entries.length > MentionBounds.TARGETS_PER_CALL) {
      ctx.addIssue({ code: "custom", message: "too many mention targets" });
      return z.NEVER;
    }
    const targets = new Map<string, MentionTarget>();
    for (const entry of entries) {
      const target = parseMentionTarget(entry);
      if (target === undefined) {
        ctx.addIssue({ code: "custom", message: "malformed mention target" });
        return z.NEVER;
      }
      targets.set(entry.toLowerCase(), target);
    }
    const uniqueTargets = [...targets.values()];
    return uniqueTargets;
  });
