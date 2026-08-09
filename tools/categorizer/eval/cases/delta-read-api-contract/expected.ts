import type { EvalProperty } from "../../properties";
import { chunksFor, dominantCategories, fires } from "../../briefQueries";

/**
 * code-review#45 (BRIEF-21 PR 1) — delta read route + PR-meta growing
 * `comparisons.lastReview` + nullable `pull_request.base_sha` (migration
 * 0006). THE BRIEF-66 positive cross-service probe: every wire contract
 * here is EXISTING and MODIFIED — the PR-meta response body the deployed
 * web app already consumes grows a field, and the shared `pull_request`
 * schema both the api and worker containers read gains a column. The
 * tightened BRIEF-55 description ("newly-added exports are NOT cross-service")
 * must not over-generalize into silencing these fires.
 *
 * Baseline reality check: recorded at 1/5 — the under-fire is REAL and
 * this case measures it. Because 1/5 is flaky-class, a future description
 * re-tune that lifts it will surface as an informational FLAKY-DELTA
 * line plus a rebaseline, never an IMPROVEMENT verdict (that class is
 * reserved for 0/5 stable-fails) — the promotion evidence is the delta
 * line, not the verdict.
 */
export const properties: EvalProperty[] = [
  {
    id: "cross-service-fires-on-changed-contract",
    description:
      "modifying existing wire contracts (PR-meta response body, shared pull_request schema) fires cross-service on at least one contract chunk (BRIEF-66 under-fire probe)",
    check: (brief) =>
      fires(brief, "cross-service", "reads.ts") ||
      fires(brief, "cross-service", "pr-view.ts") ||
      fires(brief, "cross-service", "pull-request.ts") ||
      fires(brief, "cross-service", "0006_pull-request-base-sha.sql"),
  },
  {
    id: "new-feature-dominant",
    description:
      "the delta read API is a new capability: at least one group is dominantly new-feature",
    check: (brief) => dominantCategories(brief).includes("new-feature"),
  },
  {
    id: "generated-snapshot-concern",
    description:
      "the drizzle meta snapshot is generated output, not implementation",
    check: (brief) =>
      chunksFor(brief, "0006_snapshot.json").length > 0 &&
      chunksFor(brief, "0006_snapshot.json").every(
        (chunk) => chunk.concern === "generated",
      ),
  },
  {
    id: "api-tests-are-test-concern",
    description: "the api reads test file carries the test concern",
    // Path-qualified: a bare "reads.test.ts" suffix also matches
    // persistence's list-reads.test.ts.
    check: (brief) =>
      chunksFor(brief, "api/test/reads.test.ts").length > 0 &&
      chunksFor(brief, "api/test/reads.test.ts").every(
        (chunk) => chunk.concern === "test",
      ),
  },
  {
    id: "coherent-grouping",
    description:
      "read route + lastReview + base_sha fold-in + plan doc: between 2 and 5 change groups",
    check: (brief) =>
      brief.changeGroups.length >= 2 && brief.changeGroups.length <= 5,
  },
];
