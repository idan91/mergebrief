import type { EvalProperty } from "../../properties";
import { chunksFor, dominantCategories, fires } from "../../briefQueries";

/**
 * code-review#112 (single-commit span cfe5a479) — repo-config origin
 * column on the brief record: migration 0011 + drizzle schema + the
 * artifact-store write path + tests, with drizzle's generated snapshot
 * riding along. The schema-change seed: category, generated-concern
 * classification, and schema-adjacent firing.
 */
export const properties: EvalProperty[] = [
  {
    id: "schema-change-dominant",
    description: "at least one group is dominantly schema-change",
    check: (brief) => dominantCategories(brief).includes("schema-change"),
  },
  {
    id: "generated-snapshot-concern",
    description:
      "drizzle's generated meta snapshot chunk carries the generated concern",
    check: (brief) => {
      const snapshots = chunksFor(brief, "0011_snapshot.json");
      return (
        snapshots.length > 0 &&
        snapshots.every((chunk) => chunk.concern === "generated")
      );
    },
  },
  {
    id: "schema-adjacent-fires",
    description:
      "a data-model change fires schema-adjacent somewhere (migration, schema, or store write path)",
    check: (brief) => fires(brief, "schema-adjacent"),
  },
  {
    id: "store-test-is-test-concern",
    description: "the artifact-store test chunk carries the test concern",
    check: (brief) => {
      const tests = chunksFor(brief, "artifact-store.test.ts");
      return (
        tests.length > 0 && tests.every((chunk) => chunk.concern === "test")
      );
    },
  },
  {
    id: "coherent-grouping",
    description: "a one-commit schema change reads as 1-2 groups",
    check: (brief) =>
      brief.changeGroups.length >= 1 && brief.changeGroups.length <= 2,
  },
];
