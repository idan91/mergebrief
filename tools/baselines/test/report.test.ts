import { describe, expect, it } from "vitest";
import { renderVerdict } from "../src/logic/report";
import { FindingKinds, RetirementReasons } from "../src/types";

const BASE = "0123456789abcdef";

describe("the verdict report", () => {
  it("splits retired entries by reason so a fix is not overstated", () => {
    const rendered = renderVerdict(BASE, {
      findings: [],
      retired: [
        {
          path: "src/a.ts",
          rule: "house/no-em-dash",
          before: 3,
          after: 0,
          reason: RetirementReasons.FIXED,
        },
        {
          path: "src/b.ts",
          rule: "house/retired-rule",
          before: 2,
          after: 0,
          reason: RetirementReasons.POLICY,
        },
        {
          path: "src/c.ts",
          rule: "house/no-em-dash",
          before: 1,
          after: 0,
          reason: RetirementReasons.DELETED,
        },
      ],
      retiredBoundaryRecords: 4,
    });
    expect(rendered).toContain(
      "suppressions retired: 1 fixed, 1 by policy, 1 with a deleted file",
    );
    expect(rendered).toContain("boundary records retired: 4");
    expect(rendered).toContain("no new or retained debt");
  });

  it("names every refusal with its subject and its reason", () => {
    const rendered = renderVerdict(BASE, {
      findings: [
        {
          kind: FindingKinds.UNCLEANED_EDIT,
          subject: "src/a.ts house/no-em-dash",
          detail: "this branch edits src/a.ts",
        },
      ],
      retired: [],
      retiredBoundaryRecords: 0,
    });
    expect(rendered).toContain("1 refusal(s):");
    expect(rendered).toContain("uncleaned-edit: src/a.ts house/no-em-dash");
    expect(rendered).toContain("this branch edits src/a.ts");
  });
});
