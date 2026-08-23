// Hono-free. URL validation and posture live in the handler; this op owns
// dedupe-by-head, the single-flight join, and the shared refresh budget
// (one client instance across head fetch + generation).
import { briefId, prStem, type PrLocator } from "brief-core";
import type { Result } from "types";
import {
  UrlBriefErrorKind,
  type GenerateControllerDeps,
  type GenerateFailure,
} from "./types";

type GenerateBriefResult = Result<
  { readonly briefId: string },
  GenerateFailure
>;

interface GenerateBriefInput {
  readonly url: string;
  readonly locator: PrLocator;
}

function isEngineUnauthorized(error: { kind: string }): boolean {
  return error.kind === UrlBriefErrorKind.UNAUTHORIZED;
}

export default {
  async generateBrief(deps: GenerateControllerDeps, input: GenerateBriefInput) {
    const head = await deps.github.run(
      (token) => deps.engine.fetchHeadSha(input.locator, token),
      isEngineUnauthorized,
    );
    if (!head.ok) {
      if (head.error.kind === "token-unreadable") {
        return {
          ok: false,
          error: { kind: "token-unreadable" },
        } satisfies GenerateBriefResult;
      }
      return {
        ok: false,
        error: { kind: "engine-failed", error: head.error },
      } satisfies GenerateBriefResult;
    }

    const stem = prStem(
      `${input.locator.owner}/${input.locator.repo}`,
      input.locator.number,
    );
    const existing = await deps.engine.lookupIndex(stem, head.value);
    if (existing != null) {
      return {
        ok: true,
        value: { briefId: briefId(stem, existing, head.value) },
      } satisfies GenerateBriefResult;
    }

    // A retry re-enters the flight under the same key — the failed flight
    // already settled and freed it, so joiners share the retry run.
    const generated = await deps.github.run(
      (token) =>
        deps.singleFlight(`${stem}@${head.value}`, () =>
          deps.engine.generate(input.url, token),
        ),
      isEngineUnauthorized,
    );
    if (!generated.ok) {
      if (generated.error.kind === "token-unreadable") {
        return {
          ok: false,
          error: { kind: "token-unreadable" },
        } satisfies GenerateBriefResult;
      }
      return {
        ok: false,
        error: { kind: "engine-failed", error: generated.error },
      } satisfies GenerateBriefResult;
    }
    const ref = generated.value;
    return {
      ok: true,
      value: {
        briefId: briefId(prStem(ref.repo, ref.number), ref.index, ref.head),
      },
    } satisfies GenerateBriefResult;
  },
};
