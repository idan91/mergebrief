import "@tanstack/react-start/server-only";

import { resolve } from "node:path";

import {
  briefId,
  fetchPrMetadata,
  generateAndWrite,
  lookupBriefIndex,
  parsePrUrl,
  prStem,
  type PrLocator,
} from "brief-core";
import {
  createGenerator,
  loadGeneratorConfig,
  type Effort,
  type Generator,
} from "generators";

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

/**
 * CONSTRUCTION-time config failure, thrown with a message this module
 * authored from ConfigError issues (env-var NAMES only — browser-safe).
 * Deliberately distinct from GeneratorError kind "config": that kind is
 * also produced at RUNTIME for provider 400/404s whose messages are
 * provider-authored text, which must go through the curated-message path.
 */
export class GeneratorConfigurationError extends Error {}

/** Message only — never the object (cause chains print recursively). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The constructed generator plus the loaded config's effort (BRIEF-75). */
interface SharedGeneration {
  generator: Generator;
  effort: Effort | undefined;
}

let sharedGenerator: Promise<SharedGeneration> | undefined;

/**
 * Single-flighted async construction: concurrent first requests share one
 * client; a failed construction clears the slot so the next request retries
 * (e.g. after the operator sets the missing env var).
 */
function sharedGeneratorOnce(): Promise<SharedGeneration> {
  sharedGenerator ??= (async () => {
    // Instance config (BRIEF-11 decision 6): MERGEBRIEF_CONFIG →
    // mergebrief.config.yaml, else zero-config defaults. The web dogfood
    // follows the same fail-fast rule as the worker; issues name env vars
    // and config fields only, so the message is browser-safe.
    const loaded = loadGeneratorConfig(process.env);
    if (!loaded.ok) {
      throw new GeneratorConfigurationError(
        `${loaded.error.issues.join("; ")} — fix mergebrief.config.yaml (or unset MERGEBRIEF_CONFIG for defaults).`,
      );
    }
    const result = await createGenerator(loaded.value.generator, {
      env: process.env,
      failureDir: "out",
    });
    if (!result.ok) {
      throw new GeneratorConfigurationError(
        `${result.error.issues.join("; ")} — add it to the web app's environment (see tools/categorizer/.env.example).`,
      );
    }
    return { generator: result.value, effort: loaded.value.generator.effort };
  })().catch((error: unknown) => {
    sharedGenerator = undefined;
    throw error;
  });
  return sharedGenerator;
}

function realEngine(): GenerateBriefEngine {
  return {
    fetchHeadSha: async (locator) => (await fetchPrMetadata(locator)).sha,
    lookupIndex: (stem, head) => lookupBriefIndex(OUT_DIR, stem, head),
    generate: async (url) => {
      const { generator, effort } = await sharedGeneratorOnce();
      const brief = await generateAndWrite(
        OUT_DIR,
        url,
        undefined,
        generator,
        () => {},
        effort,
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
 * error states; a construction ConfigError (GeneratorError kind config)
 * names env VARS only, so it is safe and specific and passes through
 * unwrapped.
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
    // Message-only logging (BRIEF-11 defense in depth): console.error on a
    // full error object prints the CAUSE CHAIN recursively — provider text
    // there may carry request contents. The worker already logs this way.
    console.error(
      `generateBriefFromUrl: failed to fetch PR metadata — ${errorMessage(error)}`,
    );
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
      if (error instanceof GeneratorConfigurationError) throw error;
      console.error(
        `generateBriefFromUrl: generation failed — ${errorMessage(error)}`,
      );
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
