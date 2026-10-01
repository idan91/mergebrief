import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** The impact levels that fail a run; the rest are logged. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/** A full-page scan runs past 20s on a two-core CI runner. */
const AXE_SCAN_BUDGET_MS = 30_000;

interface AxeViolation {
  id: string;
  impact?: string | null | undefined;
  help: string;
  nodes: readonly { target: readonly unknown[] }[];
}

function describe(violation: AxeViolation): string {
  const targets = violation.nodes
    .slice(0, 3)
    .map((node) => JSON.stringify(node.target))
    .join(", ");
  return `${violation.impact ?? "unknown"} · ${violation.id} — ${violation.help} (${String(violation.nodes.length)} node(s): ${targets})`;
}

/**
 * Run axe-core over the current page state and assert the gate.
 *
 * Serious/critical violations fail the spec with the rule id and the first
 * offending selectors inline, since a bare count is not actionable. Moderate and
 * minor ones are attached to the test report instead of thrown, so the
 * backlog stays visible without turning every advisory rule into a blocker.
 *
 * `stateName` names the page state under test (a page can be swept several
 * times) and keys the attachment.
 */
export async function expectNoSeriousAxeViolations(
  page: Page,
  testInfo: TestInfo,
  stateName: string,
): Promise<void> {
  testInfo.setTimeout(testInfo.timeout + AXE_SCAN_BUDGET_MS);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const violations: AxeViolation[] = results.violations;
  const blocking = violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );
  const advisory = violations.filter(
    (violation) => !BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );

  if (advisory.length > 0) {
    await testInfo.attach(`axe-advisory-${stateName}`, {
      body: advisory.map(describe).join("\n"),
      contentType: "text/plain",
    });
  }

  expect(
    blocking.map(describe),
    `serious/critical axe violations on "${stateName}"`,
  ).toEqual([]);
}
