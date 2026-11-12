import { describe, expect, it } from "vitest";
import {
  buildDeltaSystemPrompt,
  buildDetailSystemPrompt,
  buildGroupingSystemPrompt,
  buildRevisionNarrativeSystemPrompt,
  buildProductDiffSystemPrompt,
  buildSummaryMediaSystemPrompt,
  buildSystemPrompt,
} from "../../src/generation/prompt";
import type { RepoContext } from "../../src/generation/repo-context";
import { OutlineForms } from "../../src/types";

/**
 * Byte-level pins on every builder's full output. The prompt is the generation
 * surface: any byte that moves is a generation change and must go through the
 * eval gate. These snapshots make text refactors provably inert: a refactor
 * ships with these files untouched; a deliberate wording change updates the
 * snapshot in the same commit AND runs the eval.
 */

const bothRepoSections: RepoContext = {
  instructions: {
    path: ".mergebrief/instructions.md",
    blobSha: "0000000000000000000000000000000000000000",
    content: "irrelevant, the system-prompt section is static",
  },
  customAttributes: [{ name: "example-attribute", criteria: "irrelevant" }],
};

describe("system prompts are byte-pinned", () => {
  it("brief, without repo context", () => {
    expect(buildSystemPrompt()).toMatchSnapshot();
  });

  it("brief, with instructions + custom attributes sections", () => {
    expect(buildSystemPrompt(bothRepoSections)).toMatchSnapshot();
  });

  it("brief, anchored regeneration", () => {
    expect(buildSystemPrompt(undefined, true)).toMatchSnapshot();
  });

  it("brief, anchored with repo-context sections in pinned order", () => {
    expect(buildSystemPrompt(bothRepoSections, true)).toMatchSnapshot();
  });

  it("brief, with the Media note", () => {
    expect(buildSystemPrompt(undefined, false, true)).toMatchSnapshot();
  });

  it("brief, anchored with the Media note", () => {
    expect(buildSystemPrompt(undefined, true, true)).toMatchSnapshot();
  });

  it("delta", () => {
    expect(buildDeltaSystemPrompt()).toMatchSnapshot();
  });

  it.each(Object.values(OutlineForms))("grouping, %s form", (form) => {
    expect(buildGroupingSystemPrompt(form)).toMatchSnapshot();
  });

  it("grouping, with instructions and without the attributes section", () => {
    const prompt = buildGroupingSystemPrompt(
      OutlineForms.LINES_40,
      bothRepoSections,
    );

    expect(prompt).toContain("## Repo instructions (semi-trusted, bounded)");
    expect(prompt).not.toContain("## Repo-defined risk attributes");
    expect(prompt).toMatchSnapshot();
  });

  it("grouping, with the Media note", () => {
    expect(
      buildGroupingSystemPrompt(OutlineForms.FULL, undefined, true),
    ).toMatchSnapshot();
  });

  it("summary media", () => {
    expect(buildSummaryMediaSystemPrompt()).toMatchSnapshot();
  });

  it("product diff", () => {
    expect(buildProductDiffSystemPrompt()).toMatchSnapshot();
  });

  it("product diff, over a previous Product diff", () => {
    expect(buildProductDiffSystemPrompt(true)).toMatchSnapshot();
  });

  it("detail, without repo context", () => {
    expect(buildDetailSystemPrompt()).toMatchSnapshot();
  });

  it("detail, with the attributes section and without instructions", () => {
    const prompt = buildDetailSystemPrompt(bothRepoSections);

    expect(prompt).toContain("## Repo-defined risk attributes");
    expect(prompt).not.toContain("## Repo instructions (semi-trusted");
    expect(prompt).toMatchSnapshot();
  });

  it("revision narrative", () => {
    expect(buildRevisionNarrativeSystemPrompt()).toMatchSnapshot();
  });
});
