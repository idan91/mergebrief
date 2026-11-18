import {
  MentionCandidateKinds,
  type MentionCandidateKind,
} from "@web/components/MarkdownTextarea/types";
import { MentionVariants, type MentionVariant } from "./types";

const GITHUB_ORIGIN = "https://github.com";
const TEAM_SEPARATOR = "/";

/** The GitHub page a resolved mention opens: the person's profile, or the team's page. */
export function buildMentionHref(
  target: string,
  kind: MentionCandidateKind,
): string {
  if (kind === MentionCandidateKinds.USER) {
    const profileHref = `${GITHUB_ORIGIN}/${target}`;
    return profileHref;
  }
  const separator = target.indexOf(TEAM_SEPARATOR);
  const org = target.slice(0, separator);
  const slug = target.slice(separator + TEAM_SEPARATOR.length);
  const teamHref = `${GITHUB_ORIGIN}/orgs/${org}/teams/${slug}`;
  return teamHref;
}

/** The viewer variant for a user mention naming the viewer, matched without case. */
export function readMentionVariant(
  target: string,
  kind: MentionCandidateKind,
  viewerLogin: string | undefined,
): MentionVariant | undefined {
  if (kind !== MentionCandidateKinds.USER) {
    return undefined;
  }
  if (viewerLogin === undefined) {
    return undefined;
  }

  const namesViewer = target.toLowerCase() === viewerLogin.toLowerCase();
  const variant = namesViewer ? MentionVariants.VIEWER : undefined;
  return variant;
}
