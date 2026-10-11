import type {
  RepoConfigContext,
  RepoConfigFileOutcome,
} from "../../../../../model/utils/repo-config";

const ERROR_OUTCOMES: ReadonlySet<string> = new Set([
  "invalid",
  "over-budget",
  "fetch-failed",
]);

/** A config file failed, warned or collided: the author must see the chip. */
export function hasRepoConfigTrouble(repoConfig: RepoConfigContext): boolean {
  const fileTrouble = repoConfig.files.some(hasFileTrouble);
  const collided = repoConfig.collisions.length > 0;
  const trouble = fileTrouble || collided;
  return trouble;
}

function hasFileTrouble(file: RepoConfigFileOutcome): boolean {
  const failed = ERROR_OUTCOMES.has(file.outcome);
  const trouble = failed || file.warning !== undefined;
  return trouble;
}

/** The blob the applied config came from, when one was applied. */
export function findAppliedSha(
  repoConfig: RepoConfigContext,
): string | undefined {
  const applied = repoConfig.files.find(
    (file) => file.outcome === "applied" && file.blobSha !== null,
  );
  return applied?.blobSha ?? undefined;
}
