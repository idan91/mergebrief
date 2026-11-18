import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { ApiError, ApiErrorCodes, type ApiErrorCode } from "../data/apiFetch";
import { Route } from "./briefs.$briefId";

const BRIEF_ID = "repo-7_2_bbbbbbbb";

type ReadOutcome = () => Promise<unknown>;

/** Keyed by each query key's head: the Brief, its diffs and the listing. */
interface LoaderReads {
  brief: ReadOutcome;
  briefDiffs: ReadOutcome;
  briefs: ReadOutcome;
}

function stubRefusal(code: ApiErrorCode, status: number): ApiError {
  return new ApiError(code, status, `/api/local-briefs/${BRIEF_ID}`);
}

function makeLateRejection(error: ApiError): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(error), 0);
  });
}

async function runLoader(reads: LoaderReads): Promise<unknown> {
  const ensureQueryData = vi.fn((options: { queryKey: readonly unknown[] }) => {
    const head = String(options.queryKey[0]);
    if (head === "brief" || head === "briefDiffs" || head === "briefs") {
      return reads[head]();
    }
    throw new Error(`unexpected read ${head}`);
  });
  const loader = Route.options.loader;
  if (typeof loader !== "function") {
    throw new Error("the brief route declares no loader");
  }

  return loader({
    context: { queryClient: { ensureQueryData } },
    params: { briefId: BRIEF_ID },
  } as never);
}

describe("brief route loader", () => {
  it("resolves when every read lands", async () => {
    const reads: LoaderReads = {
      brief: async () => ({}),
      briefDiffs: async () => [],
      briefs: async () => [],
    };

    await expect(runLoader(reads)).resolves.toBeUndefined();
  });

  it("answers a missing Brief with a 404 though its diffs refuse first", async () => {
    const reads: LoaderReads = {
      brief: () => makeLateRejection(stubRefusal(ApiErrorCodes.NOT_FOUND, 404)),
      briefDiffs: async () => {
        throw stubRefusal(ApiErrorCodes.ARTIFACT_UNREADABLE, 404);
      },
      briefs: async () => [],
    };

    await expect(runLoader(reads)).rejects.toSatisfy(isNotFound);
  });

  it("rethrows any other refusal with its code", async () => {
    const reads: LoaderReads = {
      brief: async () => {
        throw stubRefusal(ApiErrorCodes.ARTIFACT_UNREADABLE, 200);
      },
      briefDiffs: async () => [],
      briefs: async () => [],
    };

    await expect(runLoader(reads)).rejects.toMatchObject({
      code: ApiErrorCodes.ARTIFACT_UNREADABLE,
    });
  });
});
