import { describe, expect, it, vi } from "vitest";

import {
  generateBriefFromUrl,
  GeneratorConfigurationError,
  type GenerateBriefEngine,
} from "./generate.server";

const URL = "https://github.com/octo/repo/pull/42";
const HEAD = "abcdef1234567890";

function fakeEngine(
  overrides: Partial<GenerateBriefEngine> = {},
): GenerateBriefEngine {
  return {
    fetchHeadSha: vi.fn().mockResolvedValue(HEAD),
    lookupIndex: vi.fn().mockResolvedValue(null),
    generate: vi.fn().mockResolvedValue({
      repo: "octo/repo",
      number: 42,
      index: 1,
      head: HEAD,
    }),
    ...overrides,
  };
}

describe("generateBriefFromUrl", () => {
  it("rejects a non-GitHub-PR URL without touching the engine", async () => {
    const engine = fakeEngine();

    await expect(
      generateBriefFromUrl("https://example.com/not-a-pr", engine),
    ).rejects.toThrow(/GitHub PR URL/);

    expect(engine.fetchHeadSha).not.toHaveBeenCalled();
    expect(engine.lookupIndex).not.toHaveBeenCalled();
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("returns the existing briefId on a dedupe hit, without generating", async () => {
    const engine = fakeEngine({ lookupIndex: vi.fn().mockResolvedValue(3) });

    const briefId = await generateBriefFromUrl(URL, engine);

    expect(briefId).toBe("octo-repo-42_3_abcdef12");
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("generates and derives the briefId from the result on a dedupe miss", async () => {
    const engine = fakeEngine();

    const briefId = await generateBriefFromUrl(URL, engine);

    expect(briefId).toBe("octo-repo-42_1_abcdef12");
    expect(engine.generate).toHaveBeenCalledWith(URL);
  });

  it("surfaces a friendly message when the head SHA fetch fails, not the raw error", async () => {
    const engine = fakeEngine({
      fetchHeadSha: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "gh: command failed: /usr/local/bin/gh pr view --repo octo/repo",
          ),
        ),
    });

    await expect(generateBriefFromUrl(URL, engine)).rejects.toThrow(
      /couldn't fetch this PR/i,
    );
  });

  it("surfaces a generic message when generation fails, not the raw error", async () => {
    const engine = fakeEngine({
      generate: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Anthropic API key sk-ant-secret invalid, request id req_123",
          ),
        ),
    });

    await expect(generateBriefFromUrl(URL, engine)).rejects.not.toThrow(
      /sk-ant-secret/,
    );
    await expect(generateBriefFromUrl(URL, engine)).rejects.toThrow(
      /couldn't generate the brief/i,
    );
  });

  it("passes a construction config error through unwrapped (issues name env vars only — safe for the browser)", async () => {
    const engine = fakeEngine({
      generate: vi
        .fn()
        .mockRejectedValue(
          new GeneratorConfigurationError(
            "ANTHROPIC_API_KEY: provider API key env var is not set",
          ),
        ),
    });

    await expect(generateBriefFromUrl(URL, engine)).rejects.toThrow(
      "ANTHROPIC_API_KEY: provider API key env var is not set",
    );
  });

  it("curates a runtime provider config error instead of passing it through", async () => {
    // GeneratorError kind "config" can carry provider-authored 400/404 text —
    // it must NOT reach the browser; only construction errors pass through.
    const providerError = Object.assign(
      new Error("400 model_not_found: provider says something detailed"),
      { name: "GeneratorError", kind: "config" },
    );
    const engine = fakeEngine({
      generate: vi.fn().mockRejectedValue(providerError),
    });

    await expect(generateBriefFromUrl(URL, engine)).rejects.toThrow(
      /couldn't generate the brief/i,
    );
  });

  it("collapses two concurrent calls for the same head into one generate() run", async () => {
    let resolveGenerate!: (value: {
      repo: string;
      number: number;
      index: number;
      head: string;
    }) => void;
    const generate = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );
    const engine = fakeEngine({ generate });

    const first = generateBriefFromUrl(URL, engine);
    const second = generateBriefFromUrl(URL, engine);
    resolveGenerate({ repo: "octo/repo", number: 42, index: 1, head: HEAD });

    const [a, b] = await Promise.all([first, second]);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(a).toBe("octo-repo-42_1_abcdef12");
    expect(b).toBe("octo-repo-42_1_abcdef12");
  });
});
