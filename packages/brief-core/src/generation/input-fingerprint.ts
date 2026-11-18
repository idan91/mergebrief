import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Mutable } from "types/utils";
import type { FetchedPr } from "../github/types";
import {
  readPrimary,
  renderBranchFacts,
  renderLinked,
  renderPrDescription,
  renderPrimaryTicket,
  renderPrTitle,
} from "./categorize";
import type { RepoContext } from "./repo-context";
import { readDescriptionMedia } from "./summary-media";

interface FingerprintInputs {
  readonly title: string;
  readonly branchFacts: string;
  readonly description: string;
  readonly linked: string;
  readonly primary: string;
  readonly repoContext?: RepoContext;
  readonly mediaKeys?: readonly string[];
}

/**
 * The fingerprint of what a generation reads beside the diff: the title,
 * branch facts, description, linked context and primary ticket as the
 * prompt renders them, the repo context as loaded, and the keys of the
 * description's Media, which keep what redaction hides from the rendered
 * description. Equal fingerprints mean a carried brief's prose, intent and
 * Summary Media rest on the same inputs.
 */
export function readInputFingerprint(
  pr: FetchedPr,
  repoContext: RepoContext | undefined,
): string {
  const inputs: Mutable<FingerprintInputs> = {
    title: renderPrTitle(pr.meta),
    branchFacts: renderBranchFacts(pr.meta),
    description: renderPrDescription(pr.meta),
    linked: renderLinked(pr.links),
    primary: renderPrimaryTicket(readPrimary(pr.primaryTicket)),
  };
  if (repoContext !== undefined) {
    inputs.repoContext = repoContext;
  }
  const mediaKeys = readDescriptionMedia(pr).map((item) => item.key);
  if (mediaKeys.length > 0) {
    inputs.mediaKeys = mediaKeys;
  }
  const serialized = JSON.stringify(inputs);
  const digest = sha256(utf8ToBytes(serialized));
  return bytesToHex(digest);
}
