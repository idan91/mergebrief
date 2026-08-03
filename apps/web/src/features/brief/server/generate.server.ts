import "@tanstack/react-start/server-only";

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
import { getServerLogger } from "../../../server/logger";

const logger = getServerLogger();

/**
 * Anchor at the WORKSPACE ROOT, never bare cwd (the BRIEF-70 rule): web and
 * worker run with different working directories, and in the docker image
 * cwd is `/app` — `resolve(cwd, "../..")` silently escaped the image into
 * `/tools/...`, so every composed artifact landed on the container's root
 * FS and died with it (found live, BRIEF-97).
 */
function workspaceRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // No checkout anchor (packaged distribution) — cwd is the best left.
      return resolve(process.cwd());
    }
    dir = parent;
  }
}

/** Load apps/web/.env if present; otherwise rely on the ambient env (mirrors the CLI's loadEnv). */
function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}
loadEnv();

/**
 * Shared with `urlBriefEngine.server` and `brief.server` — ONE store.
 * `MERGEBRIEF_OUT_DIR` repoints it at another directory: the browser suite
 * (BRIEF-113) boots the server over its committed fixture set so the local
 * path serves exactly those artifacts and nothing a developer happens to
 * have generated. Read AFTER `loadEnv` so `.env` can set it too.
 */
export const OUT_DIR = process.env["MERGEBRIEF_OUT_DIR"]
  ? resolve(process.env["MERGEBRIEF_OUT_DIR"])
  : join(workspaceRoot(), "tools/categorizer/out");

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

/** Node's execFile surfaces a missing binary as an Error with `code: "ENOENT"`. */
function isSpawnGhMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    error.message.includes("gh")
  );
}

/** The constructed generator plus the loaded config's effort (BRIEF-75). */
export interface SharedGeneration {
  generator: Generator;
  effort: Effort | undefined;
}

let sharedGenerator: Promise<SharedGeneration> | undefined;

/**
 * Single-flighted async construction: concurrent first requests share one
 * client; a failed construction clears the slot so the next request retries
 * (e.g. after the operator sets the missing env var). Shared with
 * `urlBriefEngine.server` — one generator client per process, either door.
 */
export function sharedGeneratorOnce(): Promise<SharedGeneration> {
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
    // Message-only logging (BRIEF-11 defense in depth): serializing the
    // full error object exposes the CAUSE CHAIN recursively — provider text
    // there may carry request contents. So no `err` field, message only.
    logger.error(
      `generateBriefFromUrl: failed to fetch PR metadata — ${errorMessage(error)}`,
    );
    // NEVER attach `{ cause: error }` here: this Error crosses the
    // createServerFn boundary, and TanStack's serializer walks non-enumerable
    // own props — a `cause` ships the raw spawn/stderr/provider text to an
    // unauthenticated browser. The server log line above is the only place
    // the raw content belongs.
    //
    // `spawn gh ENOENT` = no gh binary in this deployment (the compose
    // containers, BRIEF-97) — blaming the URL or gh auth misleads; the
    // signed-in path is the one that works here.
    if (isSpawnGhMissing(error)) {
      // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
      throw new Error(
        "This deployment has no gh CLI — sign in with GitHub to generate with your account.",
      );
    }
    // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
    throw new Error(
      "Couldn't fetch this PR — is it public, and are you `gh auth login`'d?",
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
      logger.error(
        `generateBriefFromUrl: generation failed — ${errorMessage(error)}`,
      );
      // No `{ cause: error }` — serialized to the browser (see the fetch
      // catch above); the raw failure is already in the server log.
      // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
      throw new Error(
        "Couldn't generate the brief for this PR — check the server logs and try again.",
      );
    }
    return briefId(
      prStem(result.repo, result.number),
      result.index,
      result.head,
    );
  });
}
