// The Entry comment — the product's front door on GitHub (ADR 0016 #3:
// activation = ONE branded comment per PR, maintained delete+repost per
// settled head, bottom-of-thread freshness; ADR 0020: clicking the deep link
// is Entry — navigation, never a compute trigger). Pure builders only; the
// delete+repost orchestration lives in `generate.ts`. The body carries no
// secrets: a public deep link and public SHAs.

export interface EntryCommentLink {
  /** The web deployment's public origin (`PUBLIC_BASE_URL`). */
  readonly publicBaseUrl: string;
  /** GitHub's immutable numeric repo id (the FE route key). */
  readonly repoId: bigint;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
}

/** The exact-span deep link into the web app's DB-brief route. */
export function entryCommentDeepLink(link: EntryCommentLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}?base=${link.baseSha}&head=${link.headSha}`;
}

/** The branded "ready" body posted once the brief artifact is readable. */
export function entryCommentBody(link: EntryCommentLink): string {
  return [
    `**[Read the Brief for this push](${entryCommentDeepLink(link)})** (\`${link.headSha.slice(0, 7)}\`)`,
    "",
    "<sub>Posted by MergeBrief — replaced on each settled push so it always links the latest revision.</sub>",
  ].join("\n");
}

/**
 * The "generating" body posted when a fresh generation starts. Same deep
 * link: the web app's diff-first wait UX renders the live diff immediately,
 * so the link is useful minutes before the Brief lands.
 */
export function entryCommentGeneratingBody(link: EntryCommentLink): string {
  return [
    `**[Brief is generating for this push…](${entryCommentDeepLink(link)})** (\`${link.headSha.slice(0, 7)}\`)`,
    "",
    "<sub>Posted by MergeBrief — the link already shows the live diff; this comment is replaced when the Brief is ready.</sub>",
  ].join("\n");
}
