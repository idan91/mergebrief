// POST /api/generate — brief an arbitrary PR URL with the VIEWER's token.
// Session-gated only (`sessionLayer`, no per-repo gate): the target repo comes
// from the pasted URL, not from an installation — the viewer-token GitHub fetch
// inside the engine IS the access check. Its denial posture is a uniform 404:
// FORBIDDEN and NOT_FOUND are indistinguishable to the caller (no existence
// leak), mirroring the cold-denial posture of the repo-gated routes.
//
// The engine is an injected port (`AppDeps.urlBriefEngine`): the web
// startup wiring supplies the octokit-PrSource + file-backed generation
// pipeline; this route owns URL validation, dedupe-by-head, single-flight,
// and the refresh-once budget. Token rides as a string so no octokit type
// crosses the port.
import { sanitizeErrorDetail } from "logging";
import { briefId, parsePrUrl, prStem, type PrLocator } from "brief-core";
import type { Context } from "hono";
import type { Result, ValueOf } from "types";
import { decryptToken } from "persistence";
import { z } from "zod";
import {
  refreshSessionToken,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "./authz";
import { ApiErrorCode, errorJson } from "../error-response";
import { PRODUCT_ACTION_ID } from "../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../product-operations/types";

// Deliberately NO "forbidden" kind: an engine implementation maps a GitHub
// FORBIDDEN onto NOT_FOUND, so a viewer who cannot read a repo sees exactly
// what a nonexistent repo shows (the uniform-404 posture above).
export const UrlBriefErrorKind = {
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  CONFIG: "config",
  INTERNAL: "internal",
} as const;

export type UrlBriefErrorKind = ValueOf<typeof UrlBriefErrorKind>;

export interface UrlBriefError {
  readonly kind: UrlBriefErrorKind;
  /**
   * Browser-safe text: curated copy or env-var NAMES (config kind) only —
   * never provider-authored or GitHub-authored message content.
   */
  readonly message: string;
}

/** What a generated brief contributes to its briefId. */
export interface GeneratedBriefRef {
  readonly repo: string;
  readonly number: number;
  readonly index: number;
  readonly head: string;
}

/**
 * The generation port the startup wiring injects. Every GitHub read inside
 * runs with the passed viewer token; expected failures come back as `Result`
 * with browser-safe messages (the engine owns detailed server-side logging).
 */
export interface UrlBriefEngine {
  fetchHeadSha(
    locator: PrLocator,
    accessToken: string,
  ): Promise<Result<string, UrlBriefError>>;
  lookupIndex(stem: string, headSha: string): Promise<number | null>;
  generate(
    url: string,
    accessToken: string,
  ): Promise<Result<GeneratedBriefRef, UrlBriefError>>;
}

const bodySchema = z.object({ url: z.string().min(1).max(500) });

/**
 * Collapse concurrent generations for the same PR-head into one run. Joining a
 * flight is access-safe: every caller proved they can READ the PR via their own
 * `fetchHeadSha` before reaching the flight, and the shared result is a briefId,
 * not viewer state. A rejected run frees the key for retry.
 */
function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}

// Runtime clamp on the ONE engine-authored string that reaches a response
// body. The port contract says config messages carry env-var NAMES only, but
// the engine is an injected, swappable implementation — a TS comment is not a
// trust boundary; this route is. The shared sanitizer does the redacting
// (first line, URLs and credential shapes out, 300-char cap); only the
// empty-result fallback is this route's own decision.
function clampConfigMessage(message: string): string {
  const clamped = sanitizeErrorDetail(message);
  return clamped === "" ? "generator configuration invalid" : clamped;
}

/** Map an engine failure to the sanitized response posture (posture note above). */
function engineFailure(c: Context<AuthzEnv>, error: UrlBriefError): Response {
  if (error.kind === UrlBriefErrorKind.UNAUTHORIZED) {
    return errorJson(c, ApiErrorCode.UNAUTHORIZED);
  }
  if (error.kind === UrlBriefErrorKind.NOT_FOUND) {
    return errorJson(c, ApiErrorCode.NOT_FOUND);
  }
  if (error.kind === UrlBriefErrorKind.CONFIG) {
    return errorJson(c, ApiErrorCode.GENERATION_CONFIG, {
      detail: clampConfigMessage(error.message),
    });
  }
  return errorJson(c, ApiErrorCode.GENERATION_FAILED);
}

/** Decrypt the session's stored access token; `undefined` if unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}

export function generateRoute(
  deps: AuthRouteDeps,
  engine: UrlBriefEngine | undefined,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  // Flights share the engine RESULT, never a Response: a Response body is
  // one-shot, so each joiner builds its own from the shared value.
  const singleFlight =
    createSingleFlight<Result<GeneratedBriefRef, UrlBriefError>>();

  app.use("/", sessionLayer(deps), accessStampLayer());

  app.action(
    {
      id: PRODUCT_ACTION_ID.GENERATE_BRIEF,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/",
    async (c) => {
      if (engine === undefined) {
        return errorJson(c, ApiErrorCode.GENERATION_UNAVAILABLE);
      }

      const body = bodySchema.safeParse(
        await c.req.json().catch(() => undefined),
      );
      if (!body.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      let locator: PrLocator;
      try {
        locator = parsePrUrl(body.data.url);
      } catch {
        return errorJson(c, ApiErrorCode.NOT_A_PR_URL);
      }

      let currentSession = c.get("session");
      let accessToken =
        c.get("accessToken") ??
        (await resolveSessionToken(deps, currentSession));
      if (accessToken === undefined) {
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }

      // One refresh-once budget per REQUEST, shared across every engine call:
      // the token can expire between the head fetch and the generation's own
      // reads.
      let refreshSpent = false;
      const spendRefresh = async (): Promise<boolean> => {
        if (refreshSpent) {
          return false;
        }
        refreshSpent = true;
        const refreshed = await refreshSessionToken(
          deps,
          currentSession,
          c.get("logger"),
        );
        if (!refreshed.ok) {
          return false;
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        return true;
      };

      let head = await engine.fetchHeadSha(locator, accessToken);
      if (
        !head.ok &&
        head.error.kind === UrlBriefErrorKind.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        head = await engine.fetchHeadSha(locator, accessToken);
      }
      if (!head.ok) {
        return engineFailure(c, head.error);
      }

      const stem = prStem(`${locator.owner}/${locator.repo}`, locator.number);
      const existing = await engine.lookupIndex(stem, head.value);
      if (existing != null) {
        return c.json({ briefId: briefId(stem, existing, head.value) }, 200, {
          "cache-control": "no-store",
        });
      }

      // The refresh-once budget covers the generate stage too: the token can
      // expire between the head fetch and the generation's own GitHub reads.
      // A retry re-enters the flight under the same key — the failed flight
      // already settled and freed it, so joiners share the retry run.
      const token = accessToken;
      let generated = await singleFlight(`${stem}@${head.value}`, () =>
        engine.generate(body.data.url, token),
      );
      if (
        !generated.ok &&
        generated.error.kind === UrlBriefErrorKind.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        const rotated = accessToken;
        generated = await singleFlight(`${stem}@${head.value}`, () =>
          engine.generate(body.data.url, rotated),
        );
      }
      if (!generated.ok) {
        return engineFailure(c, generated.error);
      }
      const ref = generated.value;
      return c.json(
        { briefId: briefId(prStem(ref.repo, ref.number), ref.index, ref.head) },
        200,
        { "cache-control": "no-store" },
      );
    },
  );

  return app;
}
