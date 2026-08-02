import { describe, expect, it } from "vitest";
import { INSTRUCTIONS_BUDGET_BYTES, RepoConfigOutcome } from "../src/constants";
import { validateRepoConfig } from "../src/validate";
import { instructionsFile } from "./helpers";

function validate(content: string) {
  return validateRepoConfig({ instructions: instructionsFile(content) });
}

/** instructions.md (ADR 0032 #10): no schema, budget check only, carried whole. */
describe("instructions.md validation", () => {
  it("carries the prose whole when within budget", () => {
    const content =
      "# Repo instructions\n\nGroup the `db/` tree as one unit.\n";
    const result = validate(content);
    expect(result.instructions?.content).toBe(content);
    expect(result.instructions?.blobSha).toBe("sha-fake");
    expect(result.instructions?.bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.outcomes[0]?.outcome).toBe(RepoConfigOutcome.APPLIED);
  });

  it("applies at exactly the byte cap and is over-budget one byte past it", () => {
    const at = "x".repeat(INSTRUCTIONS_BUDGET_BYTES);
    expect(validate(at).outcomes[0]?.outcome).toBe(RepoConfigOutcome.APPLIED);

    const over = "x".repeat(INSTRUCTIONS_BUDGET_BYTES + 1);
    const result = validate(over);
    expect(result.instructions).toBeUndefined();
    expect(result.outcomes[0]?.outcome).toBe(RepoConfigOutcome.OVER_BUDGET);
    expect(result.outcomes[0]?.bytesUsed).toBe(INSTRUCTIONS_BUDGET_BYTES + 1);
    expect(result.outcomes[0]?.bytesBudget).toBe(INSTRUCTIONS_BUDGET_BYTES);
  });

  it("warns (but stays applied) when nearing the cap", () => {
    const content = "x".repeat(Math.ceil(INSTRUCTIONS_BUDGET_BYTES * 0.85));
    const result = validate(content);
    expect(result.outcomes[0]?.outcome).toBe(RepoConfigOutcome.APPLIED);
    expect(result.outcomes[0]?.warning).toContain("nearing the cap");
  });

  it("counts UTF-8 bytes, not characters, for multibyte content", () => {
    const content = "🎉".repeat(10); // 10 chars, 40 bytes
    expect(content).toHaveLength(20); // JS string length counts UTF-16 units
    const result = validate(content);
    expect(result.instructions?.bytes).toBe(40);
    expect(result.outcomes[0]?.bytesUsed).toBe(40);
  });

  it("treats multibyte content at the byte cap correctly", () => {
    // 4 bytes each × (budget/4) == exactly the budget in bytes.
    const at = "🎉".repeat(INSTRUCTIONS_BUDGET_BYTES / 4);
    expect(validate(at).outcomes[0]?.outcome).toBe(RepoConfigOutcome.APPLIED);
    const over = `${at}🎉`;
    expect(validate(over).outcomes[0]?.outcome).toBe(
      RepoConfigOutcome.OVER_BUDGET,
    );
  });
});
