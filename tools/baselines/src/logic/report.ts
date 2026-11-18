import { RetirementReasons, type BaselineVerdict } from "../types";

function countByReason(verdict: BaselineVerdict, reason: string): number {
  return verdict.retired.filter((entry) => entry.reason === reason).length;
}

/**
 * The reviewer's line: what this branch actually fixed, separately from what
 * a policy change or a deletion retired, then every refusal.
 */
export function renderVerdict(
  baseCommit: string,
  verdict: BaselineVerdict,
): string {
  const lines = [`baselines: comparing the working tree against ${baseCommit}`];

  const fixed = countByReason(verdict, RetirementReasons.FIXED);
  const policy = countByReason(verdict, RetirementReasons.POLICY);
  const deleted = countByReason(verdict, RetirementReasons.DELETED);
  lines.push(
    `  suppressions retired: ${fixed} fixed, ${policy} by policy, ${deleted} with a deleted file`,
  );
  lines.push(`  boundary records retired: ${verdict.retiredBoundaryRecords}`);

  if (verdict.findings.length === 0) {
    lines.push("  no new or retained debt");
    return lines.join("\n");
  }
  lines.push(`  ${verdict.findings.length} refusal(s):`);
  for (const finding of verdict.findings) {
    lines.push(`    ${finding.kind}: ${finding.subject}`);
    lines.push(`      ${finding.detail}`);
  }
  return lines.join("\n");
}
