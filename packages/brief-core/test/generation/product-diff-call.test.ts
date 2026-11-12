import { GeneratorError, GeneratorErrorKinds } from "generators";
import { describe, expect, it } from "vitest";
import { generateBrief } from "../../src/generation/brief";
import type { GenerateBriefOptions } from "../../src/generation/brief/types";
import { PRODUCT_DIFF_LABEL } from "../../src/generation/product-diff/consts";
import {
  GenerationWarningKinds,
  type GenerationWarning,
} from "../../src/generation/warnings/types";
import { BriefSchema, ProductDiffAnswerSchema } from "../../src/types";
import {
  FakeGenerator,
  makeProductChange,
  type RecordedRequest,
} from "../helpers";
import {
  makeAnswer,
  makeOptions as makeMultiCallOptions,
  pr,
  singleBrief,
} from "./fixtures/multi-call-pr";

const archiveRestore = makeProductChange();

function makeSingleCallOptions(
  generator: FakeGenerator,
  overrides: Partial<GenerateBriefOptions> = {},
): GenerateBriefOptions {
  return {
    pr,
    headIndex: 1,
    commitRange: { base: "base0007", head: "head0007", commitCount: 1 },
    generator,
    ...overrides,
  };
}

function stubProductDiffAnswer(answer: unknown): FakeGenerator {
  return new FakeGenerator(
    () => singleBrief,
    () => answer,
  );
}

function stubProductDiffFailure(error: Error): FakeGenerator {
  return new FakeGenerator(
    () => singleBrief,
    () => {
      throw error;
    },
  );
}

function listProductDiffIssues(
  warnings: readonly GenerationWarning[],
): readonly string[] {
  return warnings.flatMap((warning) => {
    const isProductDiffCheck =
      warning.kind === GenerationWarningKinds.VALIDATION &&
      warning.check === "product diff";
    return isProductDiffCheck ? warning.issues : [];
  });
}

function renderRequest(request: RecordedRequest | undefined): string {
  if (request === undefined) {
    return "(no request)";
  }
  return `label: ${request.label}\n\n=== system ===\n${request.system}\n\n=== user ===\n${request.user}\n`;
}

describe("generateBrief Product diff, after a one-call brief", () => {
  it("writes the Product diff in its own call after the brief", async () => {
    const generator = stubProductDiffAnswer({
      changes: [archiveRestore],
      hasMore: false,
    });

    const { brief } = await generateBrief(makeSingleCallOptions(generator));

    expect(generator.requests).toHaveLength(1);
    expect(generator.productDiffRequests).toHaveLength(1);
    expect(brief.productDiff).toEqual({
      availability: "available",
      changes: [archiveRestore],
      hasMore: false,
    });
  });

  it("sends the PR text, the change-groups and the diff", async () => {
    const generator = stubProductDiffAnswer({ changes: [], hasMore: false });

    await generateBrief(makeSingleCallOptions(generator));

    const request = generator.productDiffRequests[0];
    expect(request?.label).toBe(PRODUCT_DIFF_LABEL);
    expect(request?.schema).toBe(ProductDiffAnswerSchema);
    expect(request?.user).toContain("<pr_title>Large change</pr_title>");
    expect(request?.user).toContain("<pr_change_groups>\n- g1: ");
    expect(request?.user).toContain("<pr_diff>\ndiff --git a/src/a.ts");
  });

  it("keeps today's Product diff request byte for byte", async () => {
    const generator = stubProductDiffAnswer({ changes: [], hasMore: false });

    await generateBrief(makeSingleCallOptions(generator));

    const rendered = renderRequest(generator.productDiffRequests[0]);
    await expect(rendered).toMatchFileSnapshot(
      "./__snapshots__/product-diff-call.txt",
    );
  });

  it("leaves the brief's own request without any Product diff text", async () => {
    const generator = stubProductDiffAnswer({ changes: [], hasMore: false });

    await generateBrief(makeSingleCallOptions(generator));

    const briefRequest = generator.requests[0];
    expect(briefRequest?.user).not.toContain("pr_change_groups");
    expect(briefRequest?.system).not.toContain("Product diff");
  });

  it("stores an answer with no change as none found", async () => {
    const generator = stubProductDiffAnswer({ changes: [], hasMore: false });

    const { brief, warnings } = await generateBrief(
      makeSingleCallOptions(generator),
    );

    expect(brief.productDiff).toEqual({
      availability: "available",
      changes: [],
      hasMore: false,
    });
    expect(listProductDiffIssues(warnings)).toEqual([]);
  });

  it("drops a change naming a group the brief does not have", async () => {
    const generator = stubProductDiffAnswer({
      changes: [archiveRestore, { ...archiveRestore, groupIds: ["g9"] }],
      hasMore: false,
    });

    const { brief, warnings } = await generateBrief(
      makeSingleCallOptions(generator),
    );

    expect(brief.productDiff?.changes).toHaveLength(1);
    expect(listProductDiffIssues(warnings)).toHaveLength(1);
  });

  it("ships no section when every change the call wrote was dropped", async () => {
    const generator = stubProductDiffAnswer({
      changes: [{ ...archiveRestore, groupIds: ["g9"] }],
      hasMore: false,
    });

    const { brief, warnings } = await generateBrief(
      makeSingleCallOptions(generator),
    );

    expect(brief.productDiff).toBeUndefined();
    expect(listProductDiffIssues(warnings)).toHaveLength(1);
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.PRODUCT_DIFF_FAILED,
      message:
        "none of the 1 product change(s) the call wrote could be kept; the brief has no Product diff",
    });
  });

  it("stores a brief the write schema accepts", async () => {
    const generator = stubProductDiffAnswer({
      changes: [{ ...archiveRestore, before: "", beforeSource: "pr-text" }],
      hasMore: true,
    });

    const { brief } = await generateBrief(makeSingleCallOptions(generator));

    expect(BriefSchema.safeParse(brief).success).toBe(true);
    expect(brief.productDiff?.changes[0]?.beforeSource).toBe("not-shown");
  });
});

describe("generateBrief Product diff, a failed call", () => {
  it("ships the brief without the section and says why", async () => {
    const refusal = new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused");
    const generator = stubProductDiffFailure(refusal);

    const { brief, warnings } = await generateBrief(
      makeSingleCallOptions(generator),
    );

    expect(brief.productDiff).toBeUndefined();
    expect(brief.changeGroups).toHaveLength(1);
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.PRODUCT_DIFF_FAILED,
      message:
        "the Product diff call failed (refusal); the brief has no Product diff",
    });
  });

  it("keeps the one-call brief when the call's answer is cut", async () => {
    const cut = new GeneratorError(GeneratorErrorKinds.OUTPUT_CUT, "cut");
    const generator = stubProductDiffFailure(cut);

    const { brief, ranAs, warnings } = await generateBrief(
      makeSingleCallOptions(generator, { multiCallHooks: {} }),
    );

    expect(ranAs).toBe("single");
    expect(generator.requests).toHaveLength(1);
    expect(brief.productDiff).toBeUndefined();
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.PRODUCT_DIFF_FAILED,
      message:
        "the Product diff call failed (output-cut); the brief has no Product diff",
    });
  });

  it("lets an error that is no generator failure end the run", async () => {
    const generator = stubProductDiffFailure(new Error("aborted"));

    const run = generateBrief(makeSingleCallOptions(generator));

    await expect(run).rejects.toThrow("aborted");
  });
});

describe("generateBrief Product diff, a multi-call brief", () => {
  it("marks the section unavailable and makes no Product diff call", async () => {
    const generator = new FakeGenerator(makeAnswer());

    const { brief, ranAs } = await generateBrief(
      makeMultiCallOptions(generator),
    );

    expect(ranAs).toBe("multi");
    expect(generator.productDiffRequests).toHaveLength(0);
    expect(brief.productDiff).toEqual({
      availability: "unavailable",
      changes: [],
      hasMore: false,
    });
  });
});
