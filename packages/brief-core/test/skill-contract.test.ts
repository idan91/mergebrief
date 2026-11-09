import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AlignmentReads,
  BriefSchema,
  IntentBuckets,
  IntentCheckSchema,
  IntentItemSchema,
  Specificities,
  TicketAlignmentSchema,
} from "../src/types";

const SKILL_DIR = new URL("../../../skills/mergebrief/", import.meta.url);
const skillText = readFileSync(new URL("SKILL.md", SKILL_DIR), "utf8");
const contractText = readFileSync(new URL("contract.md", SKILL_DIR), "utf8");

const INTENT_HEADING = "## The intent check";
const UNCITED_INTENT_FIELDS = new Set(["ticketUrls", "ticketTitles"]);

function listStoredIntentNames(): string[] {
  return [
    ...Object.keys(IntentCheckSchema.shape),
    ...Object.keys(IntentItemSchema.shape),
    ...Object.keys(TicketAlignmentSchema.shape),
    ...Object.values(AlignmentReads),
    ...Object.values(Specificities),
  ];
}

function readIntentSection(): string {
  const start = contractText.indexOf(INTENT_HEADING);
  if (start === -1) {
    return "";
  }

  const end = contractText.indexOf("\n## ", start + INTENT_HEADING.length);
  if (end === -1) {
    return contractText.slice(start);
  }
  return contractText.slice(start, end);
}

function readSkillIntentBlocks(): string {
  return skillText
    .split(/\n(?=\d+\. )|\n\n/)
    .filter((block) => /intent ?check/i.test(block))
    .join("\n");
}

function collectBareNames(text: string): string[] {
  return [...text.matchAll(/`([A-Za-z]+)`/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

function collectCodeSpanWords(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const span of text.matchAll(/`([^`]+)`/g)) {
    for (const word of (span[1] ?? "").matchAll(/[A-Za-z]+/g)) {
      words.add(word[0]);
    }
  }
  return words;
}

describe("skill contract for the intent check", () => {
  it("the contract names every stored intent-check field and value", () => {
    const section = readIntentSection();
    expect(section).not.toBe("");

    const spanWords = collectCodeSpanWords(section);
    const cited = listStoredIntentNames().filter(
      (name) => !UNCITED_INTENT_FIELDS.has(name),
    );
    for (const name of cited) {
      expect(spanWords.has(name), `name "${name}"`).toBe(true);
    }
  });

  it("the skill weighs every intent bucket", () => {
    const spanWords = collectCodeSpanWords(readSkillIntentBlocks());

    for (const bucket of Object.values(IntentBuckets)) {
      expect(spanWords.has(bucket), `bucket "${bucket}"`).toBe(true);
    }
  });

  it("every intent-check name the skill cites is a stored one", () => {
    const known = new Set([
      ...listStoredIntentNames(),
      ...Object.keys(BriefSchema.shape),
    ]);
    const cited = collectBareNames(
      `${readSkillIntentBlocks()}\n${readIntentSection()}`,
    );
    expect(cited.length).toBeGreaterThan(0);

    for (const name of cited) {
      expect(known.has(name), `cites "${name}"`).toBe(true);
    }
  });
});
