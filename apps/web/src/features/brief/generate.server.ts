import "@tanstack/react-start/server-only";

import { resolve } from "node:path";

import {
  AnthropicGenerator,
  briefId,
  fetchPrMetadata,
  generateAndWrite,
  lookupBriefIndex,
  parsePrUrl,
  prStem,
  type Generator,
  type PrLocator,
} from "categorizer";

import { createSingleFlight } from "./singleFlight";

const OUT_DIR = resolve(process.cwd(), "../../tools/categorizer/out");

/** Load apps/web/.env if present; otherwise rely on the ambient env (mirrors the CLI's loadEnv). */
function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}
loadEnv();

/** What a generated brief contributes to its briefId — the engine's result shape. */
export interface GeneratedBrief {
  repo: string;
  number: number;
  index: number;
  head: string;
}

/**
 * The engine boundary `generateBriefFromUrl` drives: the real `gh`/model
 * pipeline by default, faked in tests so dedupe and single-flight decisions
 * can be exercised without touching `gh` or the model (the model call itself
 * is the engine's concern, covered in tools/categorizer/test).
 */
export interface GenerateBriefEngine {
  fetchHeadSha(locator: PrLocator): Promise<string>;
  lookupIndex(stem: string, head: string): Promise<number | null>;
  generate(url: string): Promise<GeneratedBrief>;
}

/** Thrown when ANTHROPIC_API_KEY is unset — already a safe, specific message, so callers don't sanitize it further. */
export class MissingApiKeyError extends Error {}

let sharedGenerator: Generator | undefined;

function realEngine(): GenerateBriefEngine {
  return {
    fetchHeadSha: async (locator) => (await fetchPrMetadata(locator)).sha,
    lookupIndex: (stem, head) => lookupBriefIndex(OUT_DIR, stem, head),
    generate: async (url) => {
      if (!process.env["ANTHROPIC_API_KEY"]) {
        throw new MissingApiKeyError(
          "ANTHROPIC_API_KEY is not set — add it to the web app's environment (see tools/categorizer/.env.example).",
        );
      }
      sharedGenerator ??= new AnthropicGenerator();
      const brief = await generateAndWrite(
        OUT_DIR,
        url,
        undefined,
        sharedGenerator,
        () => {},
      );
      return {
        repo: brief.pr.repo,
        number: brief.pr.number,
        index: brief.index,
        head: brief.commitRange.head,
      };
    },
  };
}

const singleFlight = createSingleFlight<string>();

/**
 * Validate → head SHA → dedupe-by-head → single-flight → generate. Returns
 * the briefId the caller redirects to.
 *
 * `gh`/SDK failures carry raw command lines and stderr in their `.message` —
 * fine for a server log, not for an unauthenticated browser response. Those
 * are logged here and replaced with the curated messages from the plan's
 * error states; `MissingApiKeyError` is already safe and specific, so it
 * passes through unwrapped.
 */
export async function generateBriefFromUrl(
  url: string,
  engine: GenerateBriefEngine = realEngine(),
): Promise<string> {
  const locator = parsePrUrl(url);

  let head: string;
  try {
    head = await engine.fetchHeadSha(locator);
  } catch (error) {
    console.error("generateBriefFromUrl: failed to fetch PR metadata", error);
    throw new Error(
      "Couldn't fetch this PR — is it public, and are you `gh auth login`'d?",
      { cause: error },
    );
  }

  const stem = prStem(`${locator.owner}/${locator.repo}`, locator.number);
  const existingIndex = await engine.lookupIndex(stem, head);
  if (existingIndex != null) return briefId(stem, existingIndex, head);

  return singleFlight(`${stem}@${head}`, async () => {
    let result: GeneratedBrief;
    try {
      result = await engine.generate(url);
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw error;
      console.error("generateBriefFromUrl: generation failed", error);
      throw new Error(
        "Couldn't generate the brief for this PR — check the server logs and try again.",
        { cause: error },
      );
    }
    return briefId(
      prStem(result.repo, result.number),
      result.index,
      result.head,
    );
  });
}
