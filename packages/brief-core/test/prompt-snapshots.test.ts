import { describe, expect, it } from "vitest";
import {
  buildDeltaSystemPrompt,
  buildRevisionNarrativeSystemPrompt,
  buildSystemPrompt,
} from "../src/prompt";
import type { RepoContext } from "../src/repo-context";

/**
 * Byte-level pins on every builder's full output (BRIEF-67). The prompt is
 * the generation surface: any byte that moves is a generation change and
 * must go through the eval gate. These snapshots make prose refactors
 * (shared-constant extraction, dedupe) provably inert — a refactor PR ships
 * with these files untouched. A deliberate wording change updates the
 * snapshot in the same commit AND runs the eval per CLAUDE.md.
 */

const bothRepoSections: RepoContext = {
  instructions: {
    path: ".mergebrief/instructions.md",
    blobSha: "0000000000000000000000000000000000000000",
    content: "irrelevant — the system-prompt section is static",
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

  it("delta", () => {
    expect(buildDeltaSystemPrompt()).toMatchSnapshot();
  });

  it("revision narrative", () => {
    expect(buildRevisionNarrativeSystemPrompt()).toMatchSnapshot();
  });
});
