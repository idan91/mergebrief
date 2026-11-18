import type { RepoSettingsV1 } from "./schemas";

export function isTrustedBot(
  settings: RepoSettingsV1 | undefined,
  login: string,
): boolean {
  const lowered = login.toLowerCase();
  const listed =
    settings?.trustedBots?.some((trusted) => trusted === lowered) ?? false;
  return listed;
}
