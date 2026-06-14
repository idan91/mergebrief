import type { Brief } from "./types.js";

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
  const byId = new Map(brief.chunks.map((c) => [c.id, c]));
  const lines: string[] = [];
  lines.push(`PR  ${brief.pr.repo}#${brief.pr.number} — ${brief.pr.title}`);
  lines.push(`    ${brief.summary}`);
  lines.push("");

  lines.push(`Change groups (${brief.changeGroups.length}):`);
  for (const g of brief.changeGroups) {
    const secondary = g.secondaryCategories.length
      ? ` (+${g.secondaryCategories.join(", ")})`
      : "";
    const uncertain = g.uncertain
      ? `  ⚠ uncertain: ${g.uncertainBetween.join(" vs ")}`
      : "";
    lines.push(`  • [${g.dominantCategory}]${secondary} ${g.summary}${uncertain}`);
    lines.push(
      `      carriers: ${g.carrierChunkIds.join(", ") || "—"}` +
        `  supporting: ${g.supportingChunkIds.join(", ") || "—"}`,
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
    const chunk = byId.get(c.id);
    lines.push(
      `  ${c.id} ${chunk?.file ?? ""} [${c.role}]: ${c.riskSurface.join(", ")}`,
    );
  }

  return lines;
}

export function printSummary(brief: Brief): void {
  console.log(summaryLines(brief).join("\n"));
}
