import type { Brief, DeltaBrief } from "./types.js";

/** First 8 chars of a SHA, for filenames and summaries. */
function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/** `<owner>-<repo>-<number>` — shared stem for a PR's output files. */
export function prStem(repo: string, number: number): string {
  return `${repo.replace("/", "-")}-${number}`;
}

/**
 * `<owner>-<repo>-<number>_<index>_<head8>` — versioned stem for one brief's
 * artifacts (ADR 0012). The index + head SHA let successive briefs of the same
 * PR coexist on disk.
 */
function briefStem(brief: Brief): string {
  return `${prStem(brief.pr.repo, brief.pr.number)}_${brief.index}_${shortSha(brief.commitRange.head)}`;
}

/** Output filename for a brief: `<stem>_<index>_<head8>.brief.json`. */
export function outName(brief: Brief): string {
  return `${briefStem(brief)}.brief.json`;
}

/** Sidecar filename for per-file diffs: `<stem>_<index>_<head8>.diffs.json`. */
export function diffsName(brief: Brief): string {
  return `${briefStem(brief)}.diffs.json`;
}

/** Sidecar filename for review comments: `<stem>_<index>_<head8>.comments.json`. */
export function commentsName(brief: Brief): string {
  return `${briefStem(brief)}.comments.json`;
}

/** Render a brief into the lines printed to stdout for human eyeballing. */
export function summaryLines(brief: Brief): string[] {
  const lines: string[] = [];
  lines.push(`PR  ${brief.pr.repo}#${brief.pr.number} — ${brief.pr.title}`);
  const { base, head, commitCount } = brief.commitRange;
  lines.push(
    `    brief _${brief.index} | ${shortSha(base)}..${shortSha(head)}, ${commitCount} commit(s)`,
  );
  lines.push(`    ${brief.summary.split("\n")[0] ?? ""}`);
  lines.push("");

  lines.push(`Change groups (${brief.changeGroups.length}):`);
  for (const g of brief.changeGroups) {
    const secondary = g.secondaryCategories.length
      ? ` (+${g.secondaryCategories.join(", ")})`
      : "";
    const uncertain = g.uncertain
      ? `  ⚠ uncertain: ${g.uncertainBetween.join(" vs ")}`
      : "";
    lines.push(`  • [${g.dominantCategory}]${secondary} ${g.title}${uncertain}`);
    const members = brief.chunks.filter((c) => c.changeGroupId === g.id);
    const carriers = members.filter((c) => c.role === "carrier").map((c) => c.id);
    const supporting = members
      .filter((c) => c.role === "supporting")
      .map((c) => c.id);
    lines.push(
      `      carriers: ${carriers.join(", ") || "—"}` +
        `  supporting: ${supporting.join(", ") || "—"}`,
    );
  }
  lines.push("");

  lines.push(`Concern view (LoC):`);
  for (const r of brief.concernView) {
    lines.push(`  ${r.concern.padEnd(14)} +${r.added} -${r.deleted}`);
  }
  lines.push("");

  const flagged = brief.chunks.filter((c) => c.riskSurface.length > 0);
  lines.push(
    `Risk-surface flags (${flagged.length}/${brief.chunks.length} chunks):`,
  );
  for (const c of flagged) {
    lines.push(`  ${c.id} ${c.file} [${c.role}]: ${c.riskSurface.join(", ")}`);
  }

  return lines;
}

export function printSummary(brief: Brief): void {
  console.log(summaryLines(brief).join("\n"));
}

/** Sidecar filename for a delta: `<owner>-<repo>-<num>-<base8>..<head8>.delta.json`. */
export function deltaOutName(delta: DeltaBrief): string {
  return `${delta.pr.repo.replace("/", "-")}-${delta.pr.number}-${shortSha(delta.baselineSha)}..${shortSha(delta.headSha)}.delta.json`;
}

/** Sidecar filename for delta per-file diffs: `<owner>-<repo>-<num>-<base8>..<head8>.delta.diffs.json`. */
export function deltaDiffsName(delta: DeltaBrief): string {
  return `${delta.pr.repo.replace("/", "-")}-${delta.pr.number}-${shortSha(delta.baselineSha)}..${shortSha(delta.headSha)}.delta.diffs.json`;
}

/** Sidecar filename for delta review comments: `<...>-<base8>..<head8>.delta.comments.json`. */
export function deltaCommentsName(delta: DeltaBrief): string {
  return `${delta.pr.repo.replace("/", "-")}-${delta.pr.number}-${shortSha(delta.baselineSha)}..${shortSha(delta.headSha)}.delta.comments.json`;
}

/** Lines printed for a delta brief (the re-review reload). */
export function deltaSummaryLines(delta: DeltaBrief): string[] {
  const lines: string[] = [];
  // Label the endpoints by brief index when both ends were briefed (e.g. _1→_2),
  // falling back to the SHA otherwise.
  const endpoint = (idx: number | null, sha: string): string =>
    idx != null ? `_${idx} (${shortSha(sha)})` : shortSha(sha);
  lines.push(
    `DELTA  ${delta.pr.repo}#${delta.pr.number} — ${endpoint(delta.baselineIndex, delta.baselineSha)} → ${endpoint(delta.headIndex, delta.headSha)}`,
  );
  lines.push(`    ${delta.summary.split("\n")[0] ?? ""}`);
  lines.push("");

  lines.push(`Changed groups (${delta.changedGroups.length}):`);
  for (const g of delta.changedGroups) {
    const secondary = g.secondaryCategories.length
      ? ` (+${g.secondaryCategories.join(", ")})`
      : "";
    const uncertain = g.uncertain
      ? `  ⚠ ${g.uncertainBetween.join(" vs ")}`
      : "";
    lines.push(`  • [${g.dominantCategory}]${secondary} ${g.title}${uncertain}`);
  }
  lines.push("");

  const flagged = delta.chunks.filter((c) => c.riskSurface.length > 0);
  lines.push(
    `Risk-surface flags (${flagged.length}/${delta.chunks.length} changed chunks):`,
  );
  for (const c of flagged) {
    lines.push(`  ${c.id} ${c.file} [${c.role}]: ${c.riskSurface.join(", ")}`);
  }
  const addressing = delta.chunks.filter(
    (c) => c.addressesComments.length > 0,
  );
  if (delta.commentsAddressed.trim() || addressing.length > 0) {
    lines.push(
      `Comments addressed (${addressing.length} chunk(s) linked):`,
    );
    lines.push(`  ${delta.commentsAddressed.split("\n")[0] ?? ""}`);
    for (const c of addressing) {
      lines.push(`  ${c.id} ${c.file} → comments ${c.addressesComments.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(`Whole-PR impact: ${delta.wholePrImpact}`);
  return lines;
}

export function printDeltaSummary(delta: DeltaBrief): void {
  console.log(deltaSummaryLines(delta).join("\n"));
}
