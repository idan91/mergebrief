import { describe, expect, it } from "vitest";
import {
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS,
  MAX_CUSTOM_ATTRIBUTES,
  POLICY_MAX_BYTES,
  RepoConfigOutcomes,
} from "../src/constants";
import { validateRepoConfig } from "../src/validate";
import { padYamlToBytes, policyFile, yaml } from "./helpers";

function validate(content: string) {
  return validateRepoConfig({ policy: policyFile(content) });
}

const policyOutcome = (content: string) => validate(content).outcomes[2];

describe("policy.yaml — shape and caps", () => {
  it("applies a valid policy and exposes surviving attributes", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: {
          "touches-migrations": {
            criteria: "changes a drizzle migration file",
          },
        },
      }),
    );
    expect(result.policy?.attributes).toHaveProperty("touches-migrations");
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("rejects an unknown top-level key", () => {
    const result = validate(yaml({ version: 1, attributes: {}, extra: true }));
    expect(result.policy).toBeUndefined();
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects an unknown version and a missing version", () => {
    expect(policyOutcome(yaml({ version: 2, attributes: {} }))?.outcome).toBe(
      RepoConfigOutcomes.INVALID,
    );
    expect(policyOutcome(yaml({ attributes: {} }))?.outcome).toBe(
      RepoConfigOutcomes.INVALID,
    );
  });

  it("rejects an unknown key inside an attribute definition", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: { "my-attr": { criteria: "x", tier: "high" } },
      }),
    );
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("accepts criteria at the char cap and rejects one over", () => {
    const at = validate(
      yaml({
        version: 1,
        attributes: { "my-attr": { criteria: "x".repeat(CRITERIA_MAX_CHARS) } },
      }),
    );
    expect(at.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    const over = validate(
      yaml({
        version: 1,
        attributes: {
          "my-attr": { criteria: "x".repeat(CRITERIA_MAX_CHARS + 1) },
        },
      }),
    );
    expect(over.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects an implication over the char cap", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: {
          "my-attr": {
            criteria: "x",
            implication: "y".repeat(IMPLICATION_MAX_CHARS + 1),
          },
        },
      }),
    );
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("accepts the maximum attribute count and rejects one over", () => {
    const attrsAt: Record<string, { criteria: string }> = {};
    for (let i = 0; i < MAX_CUSTOM_ATTRIBUTES; i += 1)
      attrsAt[`attr-${i}`] = { criteria: "x" };
    expect(
      policyOutcome(yaml({ version: 1, attributes: attrsAt }))?.outcome,
    ).toBe(RepoConfigOutcomes.APPLIED);

    const attrsOver = {
      ...attrsAt,
      [`attr-${MAX_CUSTOM_ATTRIBUTES}`]: { criteria: "x" },
    };
    expect(
      policyOutcome(yaml({ version: 1, attributes: attrsOver }))?.outcome,
    ).toBe(RepoConfigOutcomes.INVALID);
  });

  it("applies at exactly the byte cap and is over-budget one byte past it", () => {
    const base = yaml({
      version: 1,
      attributes: { "my-attr": { criteria: "x" } },
    });
    const at = padYamlToBytes(base, POLICY_MAX_BYTES);
    expect(Buffer.byteLength(at, "utf8")).toBe(POLICY_MAX_BYTES);
    expect(policyOutcome(at)?.outcome).toBe(RepoConfigOutcomes.APPLIED);

    const over = padYamlToBytes(base, POLICY_MAX_BYTES + 1);
    const overOutcome = policyOutcome(over);
    expect(overOutcome?.outcome).toBe(RepoConfigOutcomes.OVER_BUDGET);
    expect(overOutcome?.bytesUsed).toBe(POLICY_MAX_BYTES + 1);
    expect(overOutcome?.bytesBudget).toBe(POLICY_MAX_BYTES);
  });
});

describe("policy.yaml — attribute name charset (security control)", () => {
  const cases: Array<[string, string]> = [
    ["uppercase", "TouchesAuth"],
    ["spaces", "has space"],
    ["leading dash", "-lead"],
    ["over length", "a".repeat(51)],
    ["empty", ""],
    ["trailing dash", "trailing-"],
    ["underscore", "snake_case"],
  ];
  for (const [label, name] of cases) {
    it(`rejects an attribute name with ${label}`, () => {
      const result = validate(
        yaml({ version: 1, attributes: { [name]: { criteria: "x" } } }),
      );
      expect(result.policy).toBeUndefined();
      expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
    });
  }

  it("accepts a name at exactly the length cap", () => {
    const name = `a${"b".repeat(49)}`; // 50 chars
    expect(name).toHaveLength(50);
    expect(
      policyOutcome(
        yaml({ version: 1, attributes: { [name]: { criteria: "x" } } }),
      )?.outcome,
    ).toBe(RepoConfigOutcomes.APPLIED);
  });
});

describe("policy.yaml — floor attributes cannot be de-emphasized", () => {
  for (const floor of FLOOR_ATTRIBUTES) {
    it(`invalidates the whole file when de-emphasizing ${floor}`, () => {
      const result = validate(
        yaml({
          version: 1,
          attributes: { "my-attr": { criteria: "x" } },
          deEmphasize: [{ attribute: floor }],
        }),
      );
      expect(result.policy).toBeUndefined();
      expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.INVALID);
    });
  }
});

describe("policy.yaml — collision resolution (built-in wins + chip)", () => {
  it("drops a custom name colliding with a built-in attribute, file stays applied", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: { "touches-auth": { criteria: "custom def" } },
      }),
    );
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.collisions).toContain("touches-auth");
    expect(result.policy?.attributes).not.toHaveProperty("touches-auth");
  });

  it("drops a custom name colliding with a parked candidate", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: { "unresolved-reference": { criteria: "x" } },
      }),
    );
    expect(result.collisions).toContain("unresolved-reference");
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("drops a custom name colliding with a reserved word (uncertain)", () => {
    const result = validate(
      yaml({ version: 1, attributes: { uncertain: { criteria: "x" } } }),
    );
    expect(result.collisions).toContain("uncertain");
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("keeps non-colliding customs alongside dropped ones", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: {
          "touches-auth": { criteria: "collides" },
          "touches-billing": { criteria: "survives" },
        },
      }),
    );
    expect(result.collisions).toEqual(["touches-auth"]);
    expect(result.policy?.attributes).toHaveProperty("touches-billing");
    expect(result.policy?.attributes).not.toHaveProperty("touches-auth");
  });
});

describe("policy.yaml — de-emphasis resolution", () => {
  it("keeps a de-emphasis entry targeting a built-in non-floor attribute", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: {},
        deEmphasize: [{ attribute: "widely-imported" }],
      }),
    );
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.policy?.deEmphasize).toEqual([
      { attribute: "widely-imported" },
    ]);
  });

  it("keeps a de-emphasis entry targeting a surviving custom attribute", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: { "touches-billing": { criteria: "x" } },
        deEmphasize: [{ attribute: "touches-billing", paths: ["billing/**"] }],
      }),
    );
    expect(result.policy?.deEmphasize).toEqual([
      { attribute: "touches-billing", paths: ["billing/**"] },
    ]);
  });

  it("warns and drops a de-emphasis entry with an unknown target", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: {},
        deEmphasize: [{ attribute: "totally-made-up" }],
      }),
    );
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.policy?.deEmphasize).toEqual([]);
    expect(result.outcomes[2]?.warning).toContain("de-emphasis");
  });

  it("warns and drops a de-emphasis entry targeting a dropped-collision custom name", () => {
    const result = validate(
      yaml({
        version: 1,
        attributes: { "unresolved-reference": { criteria: "x" } },
        deEmphasize: [{ attribute: "unresolved-reference" }],
      }),
    );
    expect(result.collisions).toContain("unresolved-reference");
    expect(result.policy?.deEmphasize).toEqual([]);
    expect(result.outcomes[2]?.warning).toContain("de-emphasis");
  });
});
