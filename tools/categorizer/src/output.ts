import type { Brief, DeltaBrief } from "./types.js";

/** First 8 chars of a SHA, for filenames and summaries. */
function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/** `<owner>-<repo>-<number>` — shared stem for a PR's output files. */
function stem(brief: Brief): string {
  return `${brief.pr.repo.replace("/", "-")}-${brief.pr.number}`;
}

/** Output filename for a brief: `<owner>-<repo>-<number>.brief.json`. */
export function outName(brief: Brief): string {
  return `${stem(brief)}.brief.json`;
}

/** Sidecar filename for per-file diffs: `<owner>-<repo>-<number>.diffs.json`. */
export function diffsName(brief: Brief): string {
  return `${stem(brief)}.diffs.json`;
}

/** Render a brief into the lines printed to stdout for human eyeballing. */
export function summaryLines(brief: Brief): string[] {
  const lines: string[] = [];
  lines.push(`PR  ${brief.pr.repo}#${brief.pr.number} — ${brief.pr.title}`);
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

/** Lines printed for a delta brief (the re-review reload). */
export function deltaSummaryLines(delta: DeltaBrief): string[] {
  const lines: string[] = [];
  lines.push(
    `DELTA  ${delta.pr.repo}#${delta.pr.number} — ${shortSha(delta.baselineSha)} → ${shortSha(delta.headSha)}`,
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
  lines.push("");
  lines.push(`Whole-PR impact: ${delta.wholePrImpact}`);
  return lines;
}

export function printDeltaSummary(delta: DeltaBrief): void {
  console.log(deltaSummaryLines(delta).join("\n"));
}
