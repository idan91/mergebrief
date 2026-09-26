// The Entry comment: ONE branded comment per PR, maintained by delete+repost
// per settled head; the deep link is navigation, never a compute trigger.
// Pure builders only; the delete+repost orchestration lives in `generate.ts`.
// The body carries no secrets: a public deep link and public SHAs.

export interface EntryCommentLink {
  /** The web deployment's public origin (`PUBLIC_BASE_URL`). */
  readonly publicBaseUrl: string;
  /** GitHub's immutable numeric repo id (the FE route key). */
  readonly repoId: bigint;
  readonly prNumber: number;
  /** The brief's index on this PR, the `rev` the web route addresses. */
  readonly headIndex: number;
  /** Named in the body's short sha, never in the link. */
  readonly headSha: string;
}

/** The revision deep link into the web app's DB-brief route. */
export function entryCommentDeepLink(link: EntryCommentLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}?rev=${String(link.headIndex)}`;
}

/** The branded "ready" body posted once the brief artifact is readable. */
export function entryCommentBody(link: EntryCommentLink): string {
  return [
    `**[Read the brief for this push](${entryCommentDeepLink(link)})** (\`${link.headSha.slice(0, 7)}\`)`,
    "",
    "<sub>Posted by MergeBrief — replaced on each settled push so it always links the latest revision.</sub>",
  ].join("\n");
}

/** Where a capped PR's comment points: the PR view, no span (none exists). */
export interface EntryCommentPrLink {
  readonly publicBaseUrl: string;
  readonly repoId: bigint;
  readonly prNumber: number;
  /** The head that was skipped, named so the thread knows which push. */
  readonly headSha: string;
  /** When generation resumes, as an ISO instant (the next UTC midnight). */
  readonly resetsAt: Date;
}

/**
 * The capped body: this push got no brief because the instance hit its daily
 * generation cap. Used ONLY to UPDATE an Entry comment that already exists;
 * a capped PR never gets one created for it, so the cap can never make
 * MergeBrief louder on a thread than it already was. Spanless link: there is
 * no brief for this head to deep-link at.
 */
export function entryCommentCappedBody(link: EntryCommentPrLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  const url = `${origin}/repos/${link.repoId}/pulls/${link.prNumber}`;
  return [
    `**Daily generation cap reached — no brief for \`${link.headSha.slice(0, 7)}\`.**`,
    "",
    `Generation resumes at ${link.resetsAt.toISOString().replace(".000Z", "Z")}; the next push after that briefs normally. [Open this PR in MergeBrief](${url})`,
    "",
    "<sub>Posted by MergeBrief — this instance's operator sets the daily cap.</sub>",
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
    "<sub>Posted by MergeBrief — the link already shows the live diff; this comment is replaced when the brief is ready.</sub>",
  ].join("\n");
}
