import type { LocalBriefSummary } from "contract";
import type { Context } from "hono";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { BadRequest } from "../../shared-errors/api-error";
import type { AuthzEnv } from "../authz";
import { ARTIFACT_HEADERS, NO_STORE } from "./consts";
import { localBriefsController } from "./controller";
import { toLocalBriefsError } from "./logic/wire-failures";
import { briefIdParamSchema } from "./schemas";
import type {
  LocalBriefsControllerDeps,
  LocalBriefsFailure,
  LocalBriefsHandlerDeps,
  LocalBriefsHandlers,
} from "./types";

/** The id is never echoed back: a refusal names no input. */
function parseBriefId(c: Context<AuthzEnv>): string {
  const parsed = briefIdParamSchema.safeParse(c.req.param("briefId"));
  if (!parsed.success) {
    throw new BadRequest();
  }
  return parsed.data;
}

/** The file's own bytes: the reader parses them, so nothing re-serializes. */
function respondWithArtifact(
  c: Context<AuthzEnv>,
  read: Result<string, LocalBriefsFailure>,
): Response {
  if (!read.ok) {
    throw toLocalBriefsError(read.error);
  }
  return c.body(read.value, HttpStatuses.OK, ARTIFACT_HEADERS);
}

export function createLocalBriefsHandlers(
  deps: LocalBriefsHandlerDeps,
): LocalBriefsHandlers {
  let cachedSummaries: readonly LocalBriefSummary[] | undefined;

  function buildDeps(c: Context<AuthzEnv>): LocalBriefsControllerDeps {
    return { dir: deps.dir, log: c.get("logger") };
  }

  return {
    listLocalBriefs: async (c) => {
      if (cachedSummaries === undefined) {
        const listed = await localBriefsController.listLocalBriefs(
          buildDeps(c),
        );
        if (!listed.ok) {
          throw toLocalBriefsError(listed.error);
        }
        cachedSummaries = listed.value;
      }
      return c.json(cachedSummaries, HttpStatuses.OK, NO_STORE);
    },
    readLocalBrief: async (c) => {
      const briefId = parseBriefId(c);
      const view = await localBriefsController.readLocalBrief(
        buildDeps(c),
        briefId,
      );
      if (!view.ok) {
        throw toLocalBriefsError(view.error);
      }
      return c.json(view.value, HttpStatuses.OK, NO_STORE);
    },
    readLocalBriefDiffs: async (c) => {
      const briefId = parseBriefId(c);
      const diffs = await localBriefsController.readLocalBriefDiffs(
        buildDeps(c),
        briefId,
      );
      return respondWithArtifact(c, diffs);
    },
    readLocalComparisonMarks: async (c) => {
      const marksId = parseBriefId(c);
      const marks = await localBriefsController.readLocalComparisonMarks(
        buildDeps(c),
        marksId,
      );
      return respondWithArtifact(c, marks);
    },
    readLocalRevisionNarrative: async (c) => {
      const narrativeId = parseBriefId(c);
      const narrative = await localBriefsController.readLocalRevisionNarrative(
        buildDeps(c),
        narrativeId,
      );
      return respondWithArtifact(c, narrative);
    },
  };
}

/** Byte-identical to a path no route serves. */
function answerAbsent(c: Context<AuthzEnv>): Response | Promise<Response> {
  return c.notFound();
}

/** No directory configured: every path answers as though unmounted. */
export function createAbsentLocalBriefsHandlers(): LocalBriefsHandlers {
  return {
    listLocalBriefs: answerAbsent,
    readLocalBrief: answerAbsent,
    readLocalBriefDiffs: answerAbsent,
    readLocalComparisonMarks: answerAbsent,
    readLocalRevisionNarrative: answerAbsent,
  };
}
