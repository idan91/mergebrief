import type { Mutable, Result } from "types/utils";

import {
  PUBLIC_BRANCH_REF,
  PUBLIC_RECORD_TAG_PREFIX,
  RELEASE_IDENTITY,
} from "../../consts";
import type {
  GitPort,
  PublicRecord,
  PublicRefs,
  ReleaseVersion,
} from "../../types";
import { compareReleaseVersions, parseReleaseVersion } from "../version";
import {
  buildReleaseCommitInputs,
  collectCoAuthorTrailers,
  formatReleaseMessage,
} from "./commit";
import {
  type ExportError,
  type PublishAction,
  PublishActions,
  type PublishInput,
  type PublishPlan,
  type PublishTarget,
} from "./types";

const SHORT_SHA = 7;
const MISMATCHES_SHOWN = 5;
const RECORD_MESSAGE_PREFIX = "public-commit";
const NO_PUBLIC_REFS: PublicRefs = { tags: new Map() };

function shorten(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

function refuse<T>(reason: string): Result<T, ExportError> {
  return { ok: false, error: { reason } };
}

interface RankedRecord {
  readonly record: PublicRecord;
  readonly version: ReleaseVersion;
}

/**
 * The last record published: the highest version, `excluding` aside.
 * `findOrderViolation` keeps exports in version order, so no date is read.
 */
function pickLatestRecord(
  records: readonly PublicRecord[],
  excluding: string,
): Result<RankedRecord | undefined, ExportError> {
  let latest: RankedRecord | undefined;
  for (const record of records) {
    if (record.version === excluding) {
      continue;
    }
    const version = parseReleaseVersion(record.version);
    if (version === undefined) {
      return refuse(
        `${PUBLIC_RECORD_TAG_PREFIX}${record.version} names no release version; fix the tag by hand`,
      );
    }
    const higher =
      latest === undefined ||
      compareReleaseVersions(version, latest.version) > 0;
    if (higher) {
      latest = { record, version };
    }
  }
  return { ok: true, value: latest };
}

/** Why `input` cannot follow `latest`: each export takes a higher version from a source that contains the last one. */
function findOrderViolation(
  git: GitPort,
  input: PublishInput,
  latest: RankedRecord | undefined,
): string | undefined {
  if (latest === undefined) {
    return undefined;
  }
  const { record } = latest;
  const version = parseReleaseVersion(input.version);
  const notAbove =
    version === undefined ||
    compareReleaseVersions(version, latest.version) <= 0;
  if (notAbove) {
    return `${input.version} is not above ${record.version}, the last version exported; export a higher version`;
  }
  if (!git.isAncestor(record.source, input.source)) {
    return `${shorten(input.source)} does not contain ${shorten(record.source)}, which ${record.version} was exported from; export a later commit on main`;
  }
  return undefined;
}

interface PublicState {
  readonly refs: PublicRefs;
  readonly notices: readonly string[];
}

function readPublicState(
  git: GitPort,
  input: PublishInput,
): Result<PublicState, ExportError> {
  const { slug, url } = input.publicRepository;
  const refs = git.fetchPublic(url, input.token);
  if (refs !== undefined) {
    return { ok: true, value: { refs, notices: [] } };
  }
  if (!input.dryRun) {
    return refuse(`public repo ${slug} not found; a publish needs it`);
  }
  const notice = `public repo ${slug} not found; planning against an empty repository (dry run only)`;
  return { ok: true, value: { refs: NO_PUBLIC_REFS, notices: [notice] } };
}

function describeDrift(
  main: string | undefined,
  parent: string | undefined,
): string {
  if (parent === undefined) {
    return `public main at ${shorten(main ?? "")} is not a release commit; reconcile first`;
  }
  if (main === undefined) {
    return `public main is missing; the last release commit is ${shorten(parent)}; reconcile first`;
  }
  return `public main at ${shorten(main)} is not the last release commit ${shorten(parent)}; reconcile first`;
}

function buildTree(
  git: GitPort,
  input: PublishInput,
): Result<string, ExportError> {
  const tree = git.writeTree(input.source, input.shipped);
  const mismatched = git.verifyTreeMatchesDir(tree, input.out);
  if (mismatched.length > 0) {
    const shown = mismatched.slice(0, MISMATCHES_SHOWN).join(", ");
    const more = mismatched.length > MISMATCHES_SHOWN ? ", ..." : "";
    return refuse(
      `the tree at ${input.out} differs from the source at ${shown}${more}`,
    );
  }
  return { ok: true, value: tree };
}

interface PlanContext {
  readonly input: PublishInput;
  readonly record: PublicRecord | undefined;
  readonly parent: string | undefined;
  readonly refs: PublicRefs;
  readonly commit: string;
}

function planActions(
  context: PlanContext,
): Result<readonly PublishAction[], ExportError> {
  const { input, record, parent, refs, commit } = context;
  const tag = `v${input.version}`;
  const actions: PublishAction[] = [];

  const recordDisagrees =
    record !== undefined && record.publicCommit !== commit;
  if (recordDisagrees) {
    return refuse(
      `${input.version} rebuilt as ${shorten(commit)} differs from recorded ${shorten(record.publicCommit)}`,
    );
  }
  if (refs.main !== commit) {
    if (refs.main !== parent) {
      return refuse(describeDrift(refs.main, record?.publicCommit ?? parent));
    }
    actions.push(PublishActions.PUSH_COMMIT);
  }

  const tagged = refs.tags.get(tag);
  if (tagged === undefined) {
    actions.push(PublishActions.PUSH_TAG);
  } else if (tagged !== commit) {
    return refuse(`tag ${tag} exists at ${shorten(tagged)}; tags never move`);
  }
  if (record === undefined) {
    actions.push(PublishActions.PUSH_RECORD);
  }
  return { ok: true, value: actions };
}

/**
 * Everything a publish needs, built in the scratch store and checked
 * against what the two remotes already hold. Nothing is pushed here.
 */
export function planPublish(
  git: GitPort,
  input: PublishInput,
): Result<PublishPlan, ExportError> {
  const listed = git.listRecords();
  if (!listed.ok) {
    return refuse(listed.error);
  }
  const records = listed.value;
  const record = records.find((known) => known.version === input.version);
  const exportedFromOtherSource =
    record !== undefined && record.source !== input.source;
  if (exportedFromOtherSource) {
    return refuse(
      `${input.version} already exported from ${shorten(record.source)}; refusing ${shorten(input.source)}`,
    );
  }
  const latest = pickLatestRecord(records, input.version);
  if (!latest.ok) {
    return latest;
  }
  const outOfOrder = findOrderViolation(git, input, latest.value);
  if (outOfOrder !== undefined) {
    return refuse(outOfOrder);
  }
  const parent = latest.value?.record.publicCommit;

  const publicState = readPublicState(git, input);
  if (!publicState.ok) {
    return publicState;
  }
  const { refs, notices } = publicState.value;
  const parentMissing = parent !== undefined && !git.hasObject(parent);
  if (parentMissing) {
    return refuse(describeDrift(refs.main, record?.publicCommit ?? parent));
  }

  const tree = buildTree(git, input);
  if (!tree.ok) {
    return tree;
  }
  const date = git.readCommitterDate(input.source);
  const trailers = collectCoAuthorTrailers(
    git.listCoAuthorTrailers(latest.value?.record.source, input.source),
  );
  const inputs = buildReleaseCommitInputs({
    treeSha: tree.value,
    parent,
    sourceCommitterDate: date,
    version: input.version,
    trailers,
  });
  const commit = git.commitTree(inputs);

  const actions = planActions({ input, record, parent, refs, commit });
  if (!actions.ok) {
    return actions;
  }
  const tag = `v${input.version}`;
  const tagObject = git.writeAnnotatedTag({
    name: tag,
    target: commit,
    message: formatReleaseMessage(input.version, []),
    tagger: RELEASE_IDENTITY,
    date,
  });
  const recordName = `${PUBLIC_RECORD_TAG_PREFIX}${input.version}`;
  const recordObject = git.writeAnnotatedTag({
    name: recordName,
    target: input.source,
    message: `${RECORD_MESSAGE_PREFIX} ${commit}\n`,
    tagger: RELEASE_IDENTITY,
    date,
  });
  const plan: Mutable<PublishPlan> = {
    version: input.version,
    source: input.source,
    commit,
    tag,
    tagObject,
    record: recordName,
    recordObject,
    changes: git.countTreeChanges(parent, commit),
    actions: actions.value,
    notices,
  };
  if (parent !== undefined) {
    plan.parent = parent;
  }
  return { ok: true, value: plan };
}

/** The pushes in order: commit, tag, then the private record last; a failure leaves the rest for a rerun. */
export function executePublish(
  git: GitPort,
  plan: PublishPlan,
  target: PublishTarget,
  onPushed: (action: PublishAction) => void,
): void {
  for (const action of plan.actions) {
    if (action === PublishActions.PUSH_COMMIT) {
      git.pushPublic(target.url, target.token, [
        `${plan.commit}:${PUBLIC_BRANCH_REF}`,
      ]);
    } else if (action === PublishActions.PUSH_TAG) {
      git.pushPublic(target.url, target.token, [
        `${plan.tagObject}:refs/tags/${plan.tag}`,
      ]);
    } else {
      git.pushRecord(plan.version, plan.recordObject);
    }
    onPushed(action);
  }
}
