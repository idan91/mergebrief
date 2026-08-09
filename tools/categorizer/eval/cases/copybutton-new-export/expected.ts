import type { EvalProperty } from "../../properties";
import { chunksFor, dominantCategories, fires } from "../../briefQueries";

/**
 * components#7 — a brand-new CopyButton component (types + impl + scss +
 * test + barrel export), +326 -0. THE BRIEF-55 seed case: the observed FP
 * stamped `cross-service` on the new prop-types file ("exported public
 * API surface") although nothing consumes it yet. The cross-service
 * properties are the measurement target for any description tightening.
 */
export const properties: EvalProperty[] = [
  {
    id: "no-cross-service-on-new-types-file",
    description:
      "the new CopyButton.types.ts must not fire cross-service — a new file has no existing external consumers (BRIEF-55 FP)",
    // The length guard blocks a vacuous pass: no validator forces chunks
    // to cover every diff file, so "file never chunked" must FAIL here,
    // not pass the case's headline property.
    check: (brief) =>
      chunksFor(brief, "CopyButton.types.ts").length > 0 &&
      !fires(brief, "cross-service", "CopyButton.types.ts"),
  },
  {
    id: "no-cross-service-anywhere",
    description:
      "an all-new component addition fires cross-service nowhere — every export is new surface, nothing can break a consumer",
    check: (brief) => !fires(brief, "cross-service"),
  },
  {
    id: "new-feature-dominant",
    description: "at least one group is dominantly new-feature",
    check: (brief) => dominantCategories(brief).includes("new-feature"),
  },
  {
    id: "coherent-grouping",
    description:
      "one new component reads as one story: between 1 and 3 change groups",
    check: (brief) =>
      brief.changeGroups.length >= 1 && brief.changeGroups.length <= 3,
  },
  {
    id: "test-file-is-test-concern",
    description: "the component's test file chunk carries the test concern",
    check: (brief) =>
      chunksFor(brief, "CopyButton.test.tsx").every(
        (chunk) => chunk.concern === "test",
      ) && chunksFor(brief, "CopyButton.test.tsx").length > 0,
  },
];
