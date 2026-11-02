import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LastReviewUnavailableReasons } from "contract";
import { cliCommandPaths } from "../scripts/command-paths";
import operationsMap from "../product-operations.map.json";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SKILL_DIR = join(REPO_ROOT, "skills", "mergebrief");

const skillText = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const contractText = readFileSync(join(SKILL_DIR, "contract.md"), "utf8");
const fullText = `${skillText}\n${contractText}`;

const EXPECTED_OP_IDS = [
  "read-pull",
  "read-brief",
  "read-brief-context",
  "read-review-session",
  "read-diff",
  "create-draft-comment",
  "update-draft-comment",
  "mark-chunk-read",
  "reclassify-group",
  "set-review-outcome",
  "read-conversation",
  "reply-to-comment",
  "resolve-thread",
  "unresolve-thread",
  "submit-review",
] as const;

// Named in prose but deliberately outside the preflight ring.
const PROSE_ONLY_IDS = ["generate-brief"] as const;
const ALL_EXPECTED_IDS = [...EXPECTED_OP_IDS, ...PROSE_ONLY_IDS];

/** Every `reason` `delta --json` can emit: the CLI's own three plus the API's. */
const DELTA_REASONS = [
  "no-checkpoint",
  "delta-not-generated",
  "unchanged",
  ...Object.values(LastReviewUnavailableReasons),
];

/** The reasons the contract's `"available":false` union line names. */
function readDeltaUnionReasons(text: string): string[] {
  const union = /"reason":((?:"[a-z-]+"\|?)+)/.exec(text)?.[1] ?? "";
  return [...union.matchAll(/"([a-z-]+)"/g)].map((match) => match[1] ?? "");
}

function collectRequiredIds(text: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const match of text.matchAll(/--require\s+([a-z\s-]+?)`/g)) {
    for (const id of (match[1] ?? "").split(/\s+/).filter(Boolean)) {
      ids.add(id);
    }
  }
  return ids;
}

// `mergebrief a b|c` names the alternatives `a b` and `a c`; placeholders and
// flags end the path.
function collectInvocations(text: string): readonly string[] {
  const invocations: string[] = [];
  for (const match of text.matchAll(
    /`mergebrief ([a-z|<>-]+)(?: ((?!--)[a-z|<>-]+))?/g,
  )) {
    const first = match[1];
    if (first === undefined || first.startsWith("<")) {
      continue;
    }
    const second = match[2];
    for (const firstAlt of first.split("|")) {
      if (second === undefined || second.startsWith("<")) {
        invocations.push(firstAlt);
        continue;
      }
      for (const secondAlt of second.split("|")) {
        invocations.push(`${firstAlt} ${secondAlt}`);
      }
    }
  }
  return invocations;
}

describe("skill drift", () => {
  it("the --require blocks name exactly the expected operation ids", () => {
    const found = collectRequiredIds(fullText);
    expect([...found].toSorted()).toEqual([...EXPECTED_OP_IDS].toSorted());
  });

  it("every expected operation id appears in the skill's prose", () => {
    for (const id of ALL_EXPECTED_IDS) {
      expect(fullText.includes(id), `id "${id}"`).toBe(true);
    }
  });

  it("every expected operation id ships a command in the map", () => {
    const commandIds = new Set(
      Object.entries(operationsMap)
        .filter(([, entry]) => "command" in entry)
        .map(([id]) => id),
    );
    for (const id of ALL_EXPECTED_IDS) {
      expect(commandIds.has(id), `operation "${id}"`).toBe(true);
    }
  });

  it("every operation id the prose mentions is in the expected list", () => {
    const knownIds = new Set(Object.keys(operationsMap));
    const mentioned = [...fullText.matchAll(/`([a-z][a-z-]+)`/g)]
      .map((match) => match[1])
      .filter((token): token is string => token !== undefined)
      .filter((token) => knownIds.has(token));
    const expected = new Set<string>(ALL_EXPECTED_IDS);
    for (const id of new Set(mentioned)) {
      expect(expected.has(id), `prose names "${id}"`).toBe(true);
    }
  });

  it("the delta union names every reason the CLI emits, each with a move", () => {
    const union = readDeltaUnionReasons(contractText);

    expect(union.toSorted()).toEqual(DELTA_REASONS.toSorted());
    for (const reason of DELTA_REASONS) {
      expect(contractText).toMatch(
        new RegExp(`\`${reason}\` (review|poll|diff)`),
      );
    }
  });

  it("every `mergebrief` invocation in the skill is a registered command", () => {
    const paths = cliCommandPaths();
    const invocations = collectInvocations(fullText);
    expect(invocations.length).toBeGreaterThan(0);
    for (const invocation of invocations) {
      expect(
        paths.has(invocation),
        `invocation "mergebrief ${invocation}"`,
      ).toBe(true);
    }
  });
});
