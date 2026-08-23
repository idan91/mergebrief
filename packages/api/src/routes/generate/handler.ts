import { parsePrUrl, type PrLocator } from "brief-core";
import type { Context } from "hono";
import { sanitizeErrorDetail } from "logging";
import { ApiErrorCode } from "../../error-response";
import {
  BadGateway,
  BadRequest,
  NotFound,
  ServiceUnavailable,
  Unauthorized,
} from "../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../auth/session";
import type { AuthzEnv } from "../authz";
import generateController from "./controller";
import { bodySchema } from "./schemas";
import {
  UrlBriefErrorKind,
  type UrlBriefEngine,
  type UrlBriefError,
} from "./types";
import type { SingleFlight } from "./utils";

const NO_STORE = { "cache-control": "no-store" } as const;

// Runtime clamp on the ONE engine-authored string that reaches a response
// body. The port contract says config messages carry env-var NAMES only, but
// the engine is an injected, swappable implementation — a TS comment is not a
// trust boundary; this route is.
function clampConfigMessage(message: string): string {
  const clamped = sanitizeErrorDetail(message);
  return clamped === "" ? "generator configuration invalid" : clamped;
}

/** Map an engine failure to the sanitized posture (uniform-404 note in index). */
function throwEngineFailure(error: UrlBriefError): never {
  if (error.kind === UrlBriefErrorKind.UNAUTHORIZED) {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (error.kind === UrlBriefErrorKind.NOT_FOUND) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  if (error.kind === UrlBriefErrorKind.CONFIG) {
    throw new ServiceUnavailable(ApiErrorCode.GENERATION_CONFIG, {
      detail: clampConfigMessage(error.message),
    });
  }
  throw new BadGateway(ApiErrorCode.GENERATION_FAILED);
}

export default function createHandlers(
  deps: AuthRouteDeps,
  engine: UrlBriefEngine | undefined,
  singleFlight: SingleFlight<Awaited<ReturnType<UrlBriefEngine["generate"]>>>,
) {
  return {
    generateBrief: async (c: Context<AuthzEnv>) => {
      if (engine === undefined) {
        throw new ServiceUnavailable(ApiErrorCode.GENERATION_UNAVAILABLE);
      }

      const body = bodySchema.safeParse(
        await c.req.json().catch(() => undefined),
      );
      if (!body.success) {
        throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
      }
      let locator: PrLocator;
      try {
        locator = parsePrUrl(body.data.url);
      } catch {
        throw new BadRequest(ApiErrorCode.NOT_A_PR_URL);
      }

      const github = createReviewerGitHubClient(
        deps,
        c.get("session"),
        c.get("logger"),
      );
      const result = await generateController.generateBrief(
        { engine, github, singleFlight },
        { url: body.data.url, locator },
      );
      if (!result.ok) {
        if (result.error.kind === "token-unreadable") {
          throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
        }
        throwEngineFailure(result.error.error);
      }
      return c.json(result.value, 200, NO_STORE);
    },
  };
}
