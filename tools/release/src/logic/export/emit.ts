import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PUBLIC_BRANCH_REF } from "../../consts";
import type { GitPort } from "../../types";
import type { EmittedPlan, PublishPlan } from "./types";

export const EMIT_BUNDLE_FILE = "release.bundle";
export const EMIT_PLAN_FILE = "plan.json";

const TAG_REF_PREFIX = "refs/tags/";
const JSON_INDENT = 2;

/**
 * The planned release as files a job without the tool can push: a bundle of
 * the release commits and both tag objects, the private history left out
 * (the record's source must already be in the pushing clone), and the plan
 * naming each object and the pushes still owed.
 */
export function emitRelease(
  git: GitPort,
  plan: PublishPlan,
  dir: string,
  publicUrl: string,
): void {
  git.writeBundle(
    join(dir, EMIT_BUNDLE_FILE),
    [
      { ref: PUBLIC_BRANCH_REF, sha: plan.commit },
      { ref: `${TAG_REF_PREFIX}${plan.tag}`, sha: plan.tagObject },
      { ref: `${TAG_REF_PREFIX}${plan.record}`, sha: plan.recordObject },
    ],
    plan.source,
  );

  const emitted: EmittedPlan = {
    publicUrl,
    version: plan.version,
    source: plan.source,
    commit: plan.commit,
    tree: plan.tree,
    tag: plan.tag,
    tagObject: plan.tagObject,
    record: plan.record,
    recordObject: plan.recordObject,
    actions: plan.actions,
  };
  writeFileSync(
    join(dir, EMIT_PLAN_FILE),
    `${JSON.stringify(emitted, null, JSON_INDENT)}\n`,
  );
}
