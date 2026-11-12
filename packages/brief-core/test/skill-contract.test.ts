import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AlignmentReads,
  BeforeSources,
  BriefSchema,
  IntentBuckets,
  IntentCheckSchema,
  IntentItemSchema,
  ProductChangeAreas,
  ProductChangeSchema,
  ProductDiffAvailabilities,
  ProductDiffSchema,
  Specificities,
  TicketAlignmentSchema,
} from "../src/types";

const SKILL_DIR = new URL("../../../skills/mergebrief/", import.meta.url);
const skillText = readFileSync(new URL("SKILL.md", SKILL_DIR), "utf8");
const contractText = readFileSync(new URL("contract.md", SKILL_DIR), "utf8");

const INTENT_HEADING = "## The intent check";
const PRODUCT_DIFF_HEADING = "## The Product diff";
/** Words a code span carries that name the command or a literal, never a stored field. */
const CLI_WORDS = ["groups", "json", "true"];
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

function listStoredProductDiffNames(): string[] {
  return [
    ...Object.keys(ProductDiffSchema.shape),
    ...Object.keys(ProductChangeSchema.shape),
    ...Object.values(ProductDiffAvailabilities),
    ...Object.values(BeforeSources),
    ...Object.values(ProductChangeAreas),
  ];
}

function readContractSection(heading: string): string {
  const start = contractText.indexOf(heading);
  if (start === -1) {
    return "";
  }

  const end = contractText.indexOf("\n## ", start + heading.length);
  if (end === -1) {
    return contractText.slice(start);
  }
  return contractText.slice(start, end);
}

function readIntentSection(): string {
  return readContractSection(INTENT_HEADING);
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

/** The numbered step of the skill that teaches the Product diff. */
function readSkillProductDiffStep(): string {
  const steps = skillText.split(/\n(?=\d+\. )|\n\n/);
  return steps.find((step) => step.includes("`productDiff` lists")) ?? "";
}

/** Kebab values whole, so `pr-text` is one token and never `pr` and `text`. */
function collectCodeSpanTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const span of text.matchAll(/`([^`]+)`/g)) {
    for (const token of (span[1] ?? "").matchAll(/[A-Za-z][A-Za-z-]*/g)) {
      tokens.add(token[0]);
    }
  }
  return tokens;
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

describe("skill contract for the Product diff", () => {
  it("the contract names every stored Product diff field and value", () => {
    const section = readContractSection(PRODUCT_DIFF_HEADING);
    expect(section).not.toBe("");

    const tokens = collectCodeSpanTokens(section);
    for (const name of listStoredProductDiffNames()) {
      expect(tokens.has(name), `name "${name}"`).toBe(true);
    }
  });

  it("every Product diff name the contract and the skill cite is stored", () => {
    const known = new Set([
      ...listStoredProductDiffNames(),
      ...Object.keys(BriefSchema.shape),
      ...CLI_WORDS,
    ]);
    const section = readContractSection(PRODUCT_DIFF_HEADING);
    const skillStep = readSkillProductDiffStep();
    expect(section).not.toBe("");
    expect(skillStep).not.toBe("");

    const cited = collectCodeSpanTokens(`${section}\n${skillStep}`);

    for (const name of cited) {
      expect(known.has(name), `cites "${name}"`).toBe(true);
    }
  });

  it("the skill tells the reviewer how to read the Product diff", () => {
    const tokens = collectCodeSpanTokens(skillText);

    expect(tokens.has("productDiff")).toBe(true);
    expect(tokens.has("beforeSource")).toBe(true);
    expect(tokens.has(ProductDiffAvailabilities.UNAVAILABLE)).toBe(true);
  });
});
