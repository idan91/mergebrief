import { describe, expect, it } from "vitest";
import { checkBaselines } from "../src/gate";
import { FindingKinds, RetirementReasons, type Finding } from "../src/types";
import {
  LINT_CONFIG_WITH_RULES,
  makeCheckout,
  removeFile,
  runGit,
  renameFile,
  stubManifest,
  stubRecords,
  stubSuppressions,
  type Tree,
} from "./helpers";

const LINT_WITH_IGNORE =
  "depcruise --ignore-known .dependency-cruiser-known-violations.json apps";
const LINT_WITHOUT_IGNORE = "depcruise apps";

function baseTree(overrides: Tree = {}): Tree {
  return {
    "package.json": stubManifest(LINT_WITH_IGNORE),
    ".oxlintrc.json": LINT_CONFIG_WITH_RULES,
    "oxlint-suppressions.json": stubSuppressions({
      "src/a.ts": { "house/no-em-dash": 3 },
      "src/b.ts": { "house/no-em-dash": 2 },
    }),
    ".dependency-cruiser-known-violations.json": stubRecords([
      {
        from: "apps/web/src/one.ts",
        to: "apps/api/src/index.ts",
        rule: "no-app-imports-another-app",
      },
      {
        from: "apps/web/src/two.ts",
        to: "apps/api/src/index.ts",
        rule: "no-app-imports-another-app",
      },
    ]),
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    ...overrides,
  };
}

function verdictOf(base: Tree, head?: Tree, mutate?: (root: string) => void) {
  const checkout = makeCheckout(base, head);
  try {
    mutate?.(checkout.root);
    const result = checkBaselines(checkout.root, "main");
    if (!result.ok)
      throw new Error(`unexpected gate error: ${result.error.message}`);
    return result.value.verdict;
  } finally {
    checkout.dispose();
  }
}

function kindsOf(findings: readonly Finding[]): readonly string[] {
  return findings.map((finding) => finding.kind);
}

describe("suppression baseline", () => {
  it("passes a branch that clears one file and leaves the rest", () => {
    const verdict = verdictOf(baseTree(), {
      "src/a.ts": "export const a = 11;\n",
      "oxlint-suppressions.json": stubSuppressions({
        "src/b.ts": { "house/no-em-dash": 2 },
      }),
    });
    expect(verdict.findings).toEqual([]);
    expect(verdict.retired).toHaveLength(1);
  });

  it("passes historical debt in files the branch never touched", () => {
    expect(verdictOf(baseTree()).findings).toEqual([]);
  });

  it("refuses a raised count", () => {
    const verdict = verdictOf(baseTree(), {
      "oxlint-suppressions.json": stubSuppressions({
        "src/a.ts": { "house/no-em-dash": 5 },
        "src/b.ts": { "house/no-em-dash": 2 },
      }),
    });
    expect(kindsOf(verdict.findings)).toContain(FindingKinds.GROWN_SUPPRESSION);
  });

  it("refuses a newly suppressed file", () => {
    const verdict = verdictOf(baseTree(), {
      "src/c.ts": "export const c = 3;\n",
      "oxlint-suppressions.json": stubSuppressions({
        "src/a.ts": { "house/no-em-dash": 3 },
        "src/b.ts": { "house/no-em-dash": 2 },
        "src/c.ts": { "house/no-em-dash": 1 },
      }),
    });
    expect(kindsOf(verdict.findings)).toContain(FindingKinds.NEW_SUPPRESSION);
  });

  it("refuses an edited file that keeps its suppressions", () => {
    const verdict = verdictOf(baseTree(), {
      "src/a.ts": "export const a = 99;\n",
    });
    expect(kindsOf(verdict.findings)).toEqual([FindingKinds.UNCLEANED_EDIT]);
    expect(verdict.findings[0]?.subject).toBe("src/a.ts house/no-em-dash");
  });

  it("refuses debt moved from one file to another", () => {
    const verdict = verdictOf(baseTree(), {
      "oxlint-suppressions.json": stubSuppressions({
        "src/b.ts": { "house/no-em-dash": 5 },
      }),
    });
    expect(kindsOf(verdict.findings)).toContain(FindingKinds.GROWN_SUPPRESSION);
  });

  it("refuses a rule total that grew across all files", () => {
    const verdict = verdictOf(baseTree(), {
      "oxlint-suppressions.json": stubSuppressions({
        "src/a.ts": { "house/no-em-dash": 3 },
        "src/b.ts": { "house/no-em-dash": 2 },
        "src/b.ts.bak": { "house/no-em-dash": 1 },
      }),
    });
    expect(kindsOf(verdict.findings)).toContain(FindingKinds.GROWN_RULE_TOTAL);
  });

  it("refuses a deleted file whose entries stayed behind", () => {
    const verdict = verdictOf(baseTree(), undefined, (root) => {
      removeFile(root, "src/a.ts");
    });
    expect(kindsOf(verdict.findings)).toEqual([FindingKinds.STALE_DELETION]);
  });

  it("refuses a rename that left its entries under the old path", () => {
    const verdict = verdictOf(baseTree(), undefined, (root) => {
      renameFile(root, "src/a.ts", "src/renamed.ts");
      runGit(root, ["add", "-A"]);
    });
    expect(kindsOf(verdict.findings)).toContain(FindingKinds.UNCLEANED_EDIT);
  });
});

describe("retirement reasons", () => {
  it("separates a fixed file from a rule the config dropped", () => {
    const verdict = verdictOf(
      baseTree({
        "oxlint-suppressions.json": stubSuppressions({
          "src/a.ts": { "house/no-em-dash": 3 },
          "src/b.ts": { "house/retired-rule": 2 },
        }),
      }),
      {
        "src/a.ts": "export const a = 11;\n",
        "oxlint-suppressions.json": stubSuppressions({}),
      },
    );
    expect(verdict.findings).toEqual([]);
    const reasons = verdict.retired.map((entry) => entry.reason);
    expect(reasons).toContain(RetirementReasons.FIXED);
    expect(reasons).toContain(RetirementReasons.POLICY);
  });

  it("marks entries retired with a deleted file as deleted", () => {
    const verdict = verdictOf(
      baseTree(),
      {
        "oxlint-suppressions.json": stubSuppressions({
          "src/b.ts": { "house/no-em-dash": 2 },
        }),
      },
      (root) => {
        removeFile(root, "src/a.ts");
      },
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.retired.map((entry) => entry.reason)).toEqual([
      RetirementReasons.DELETED,
    ]);
  });
});

describe("boundary records", () => {
  it("passes when records only disappear", () => {
    const verdict = verdictOf(baseTree(), {
      ".dependency-cruiser-known-violations.json": stubRecords([
        {
          from: "apps/web/src/one.ts",
          to: "apps/api/src/index.ts",
          rule: "no-app-imports-another-app",
        },
      ]),
    });
    expect(verdict.findings).toEqual([]);
    expect(verdict.retiredBoundaryRecords).toBe(1);
  });

  it("refuses a record the base did not carry", () => {
    const verdict = verdictOf(baseTree(), {
      ".dependency-cruiser-known-violations.json": stubRecords([
        {
          from: "apps/web/src/one.ts",
          to: "apps/api/src/index.ts",
          rule: "no-app-imports-another-app",
        },
        {
          from: "apps/cli/src/new.ts",
          to: "apps/api/src/index.ts",
          rule: "no-app-imports-another-app",
        },
      ]),
    });
    expect(kindsOf(verdict.findings)).toEqual([
      FindingKinds.NEW_BOUNDARY_RECORD,
    ]);
  });

  it("refuses keeping the ignore flag once the records file is gone", () => {
    const verdict = verdictOf(baseTree(), undefined, (root) => {
      removeFile(root, ".dependency-cruiser-known-violations.json");
    });
    expect(kindsOf(verdict.findings)).toEqual([
      FindingKinds.BOUNDARY_IGNORE_STILL_WIRED,
    ]);
  });

  it("passes a retired records file once the flag is gone too", () => {
    const verdict = verdictOf(
      baseTree(),
      { "package.json": stubManifest(LINT_WITHOUT_IGNORE) },
      (root) => {
        removeFile(root, ".dependency-cruiser-known-violations.json");
      },
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.retiredBoundaryRecords).toBe(2);
  });

  it("refuses re-creating the records file after it was retired", () => {
    const withoutRecords: Tree = {
      "package.json": stubManifest(LINT_WITHOUT_IGNORE),
      ".oxlintrc.json": LINT_CONFIG_WITH_RULES,
      "oxlint-suppressions.json": stubSuppressions({}),
      "src/a.ts": "export const a = 1;\n",
    };
    const verdict = verdictOf(withoutRecords, {
      ".dependency-cruiser-known-violations.json": stubRecords([
        {
          from: "apps/web/src/one.ts",
          to: "apps/api/src/index.ts",
          rule: "no-app-imports-another-app",
        },
      ]),
    });
    expect(kindsOf(verdict.findings)).toEqual([
      FindingKinds.BOUNDARY_BASELINE_REINTRODUCED,
    ]);
  });
});
