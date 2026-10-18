import type { EvalProperty } from "../../properties";
import {
  chunksFor,
  dominantCategories,
  firstGroupIndex,
  fires,
  groupIdsFor,
} from "../../briefQueries";

/**
 * A delta read route, PR-meta growing `comparisons.lastReview`, and a
 * folded-in nullable `pull_request.base_sha` column. The positive
 * cross-service probe: every wire contract here already exists and is
 * modified. The PR-meta body the deployed web app reads grows a field, and
 * the `pull_request` schema both the api and worker read gains a column, so
 * the "newly-added exports are not cross-service" rule must not silence it.
 */
const BASE_SHA_MIGRATION = "drizzle/0006_pull-request-base-sha.sql";

export const properties: EvalProperty[] = [
  {
    id: "cross-service-fires-on-changed-contract",
    description:
      "modifying existing wire contracts (PR-meta response body, shared pull_request schema) fires cross-service on at least one contract chunk (the under-fire probe)",
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
  {
    id: "base-sha-fold-in-reads-after-main-groups",
    description:
      "story order: the base_sha fold-in sits beside the delta read and lastReview work, so it reads after every group carrying them",
    check: (brief) => {
      const [foldInGroup, ...extra] = groupIdsFor(brief, BASE_SHA_MIGRATION);
      const mainGroups = new Set([
        ...groupIdsFor(brief, "src/routes/reads.ts"),
        ...groupIdsFor(brief, "src/artifact-store.ts"),
      ]);
      const foldInIsOneGroup = foldInGroup !== undefined && extra.length === 0;
      if (!foldInIsOneGroup) {
        return false;
      }
      const foldInStandsApart =
        mainGroups.size > 0 && !mainGroups.has(foldInGroup);
      if (!foldInStandsApart) {
        return false;
      }
      const foldInIndex = firstGroupIndex(brief, (id) => id === foldInGroup);
      const mainIndexes = [...mainGroups].map((id) =>
        firstGroupIndex(brief, (candidate) => candidate === id),
      );
      const lastMainIndex = Math.max(...mainIndexes);
      return lastMainIndex < foldInIndex;
    },
  },
];
