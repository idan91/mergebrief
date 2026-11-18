import {
  NPM_PACKAGE,
  OPERATIONS_DOC_PATH,
  RC_DIST_TAG,
  REPOSITORY_URL,
  UPGRADE_CHAIN,
  UPGRADE_CHAIN_PLACEHOLDER,
} from "../consts";
import type { ReleaseNotes, ReleaseVersion } from "../types";
import {
  formatReleaseTag,
  formatReleaseVersion,
  isStableVersion,
} from "./version";

const BREAKING_LEAD =
  "This is a breaking release: the chain below is not enough. Read the Upgrade section of these notes first and follow its steps in order.";
const SECURITY_LEAD =
  "This release fixes a security issue. Upgrade now; the version notice stays on every instance until it runs this release.";
const DEFAULT_LEAD =
  "Run these in the folder that holds `docker-compose.yml` and `.env`.";

export function buildReleasePageUrl(version: ReleaseVersion): string {
  const url = `${REPOSITORY_URL}/releases/tag/${formatReleaseTag(version)}`;
  return url;
}

/** The GitHub Release body: the upgrade step with the tag filled in, then the notes. */
export function buildReleaseBody(notes: ReleaseNotes): string {
  const stable = isStableVersion(notes.version);
  const body = stable ? buildStableBody(notes) : buildCandidateBody(notes);
  return body;
}

function buildStableBody(notes: ReleaseNotes): string {
  const version = formatReleaseVersion(notes.version);
  const tag = formatReleaseTag(notes.version);
  const docs = `${REPOSITORY_URL}/blob/${tag}/${OPERATIONS_DOC_PATH}`;
  const chain = UPGRADE_CHAIN.replaceAll(UPGRADE_CHAIN_PLACEHOLDER, tag);

  const body = [
    `## Upgrade to ${version}`,
    "",
    buildLead(notes),
    "",
    "```sh",
    chain,
    "```",
    "",
    `The first line is the backup, the only way back across more than one release ([Backup](${docs}#backup)). The full walk is [the upgrade step](${docs}#the-upgrade-step); going back is [Rolling back](${docs}#rolling-back).`,
    "",
    notes.body,
  ].join("\n");
  return body;
}

function buildLead(notes: ReleaseNotes): string {
  const leads: string[] = [];
  if (notes.security) {
    leads.push(SECURITY_LEAD);
  }
  if (notes.breaking) {
    leads.push(BREAKING_LEAD);
  }
  leads.push(DEFAULT_LEAD);
  const lead = leads.join(" ");
  return lead;
}

function buildCandidateBody(notes: ReleaseNotes): string {
  const version = formatReleaseVersion(notes.version);

  const body = [
    `## Release candidate ${version}`,
    "",
    `Not for production. The image is \`ghcr.io/idan91/mergebrief:${version}\` and the CLI is \`${NPM_PACKAGE}@${version}\` under the \`${RC_DIST_TAG}\` dist-tag: \`npm i -g ${NPM_PACKAGE}@${RC_DIST_TAG}\`. Nothing here becomes \`latest\`, and no instance is told about it.`,
    "",
    notes.body,
  ].join("\n");
  return body;
}
