import type { Result, TicketTracker } from "types";
import type { ConfigError, ContextSourcesConfig } from "generators";
import type { RepoName, TrackerConfig } from "generators/trackers";
import type { ReferenceLocation } from "../../types";
import type {
  ContextProviderDeps,
  ContextReadFailure,
  PrimarySnippet,
} from "../types";
import type { GitHubTransport } from "./github/transport";
import type { JiraTransport } from "./jira/transport";
import type { NotionTransport } from "./notion/transport";

/** The deployment's Jira Cloud site, as the instance config's `type: jira` entry names it. */
export interface JiraSite {
  /** The `.atlassian.net` host, lower-case; every issue URL is built on it. */
  readonly host: string;
  /** Other hosts whose issue links are this site's, such as a custom domain; lower-case. */
  readonly linkHosts: readonly string[];
}

/** The pure parser's input: PR text plus what the deployment can resolve. */
export interface TicketReferenceInput {
  readonly title: string;
  readonly body: string;
  /** Head branch name; "" when unknown. */
  readonly branch: string;
  /** The PR's own repo: where a bare `#N` resolves without `issuesRepo`. */
  readonly repo: RepoName;
  /** The repo's trackers, in file order; empty means keys never match. */
  readonly trackers: readonly TrackerConfig[];
  /** The trackers this root can read; a tracker whose URLs are plain links without a read checks for its kind here. */
  readonly readable: readonly TicketTracker[];
  /** Absent when the instance config has no `type: jira` entry: a Jira link is then text and a Jira key has no URL. */
  readonly jiraSite?: JiraSite | undefined;
}

/** What a tracker checks a URL against: the repo's trackers and the deployment's Jira site. */
export type TrackerUrlInput = Pick<
  TicketReferenceInput,
  "trackers" | "jiraSite"
>;

export interface TicketReference {
  readonly tracker: TicketTracker;
  /** `PREFIX-N` for a key reference, else "". */
  readonly key: string;
  /** GitHub issue number; absent for every other tracker. */
  readonly number?: number;
  /** Notion page id (32 hex); absent for GitHub and for a Notion key. */
  readonly pageId?: string;
  /** The board a Notion key resolves in; absent for GitHub and page URLs. */
  readonly databaseId?: string;
  /** Canonical URL; "" for a Notion key until the provider resolves it, and for a Jira key when the instance names no Jira site. */
  readonly url: string;
  readonly foundIn: ReferenceLocation;
  /** Introduced by a closing keyword in the description. */
  readonly closing: boolean;
}

/** A reference before its location facts, with its offset for reading order. */
export interface ReferenceHit {
  readonly index: number;
  readonly reference: Omit<TicketReference, "foundIn" | "closing">;
}

/** What every root offers every tracker: tokens by NAME from `env`, the instance config's `contextSources:` entries and its default `trackers:`. */
export interface SharedRootDeps {
  readonly env: Record<string, string | undefined>;
  readonly contextSources: ContextSourcesConfig;
  /** The instance's boards; a repo whose settings name none reads these. */
  readonly trackers?: readonly TrackerConfig[];
}

/**
 * Each tracker's own transport, declared in its module and registered here
 * under its `TicketTracker` kind; a kind without a line fails to compile. A
 * new tracker adds one line; nothing that resolves a read changes.
 */
export interface TrackerTransports {
  readonly github: GitHubTransport;
  readonly notion: NotionTransport;
  readonly jira: JiraTransport;
}

/** A composition root: the shared deps plus one transport slot per tracker it serves. */
export interface TrackerRootDeps extends SharedRootDeps {
  readonly transports: {
    readonly [Kind in TicketTracker]?: TrackerTransports[Kind] | undefined;
  };
}

/** A tracker's read, built for one root: the primary ticket a reference names. */
export interface PrimaryRead {
  readonly kind: TicketTracker;
  readPrimary(
    reference: TicketReference,
    deps: ContextProviderDeps,
  ): Promise<Result<PrimarySnippet, ContextReadFailure>>;
}

/**
 * One tracker, implemented once per kind: its reference syntax, its URL
 * form, and its read. `trackers/index.ts` lists them and hands each its
 * own transport slot the same way; a tracker never sees another's.
 */
export interface Tracker<Kind extends TicketTracker = TicketTracker> {
  readonly kind: Kind;
  /** This tracker's references in one location's text, offsets kept. */
  collectReferences(
    text: string,
    location: ReferenceLocation,
    input: TicketReferenceInput,
  ): ReferenceHit[];
  /** The canonical form of a URL this tracker owns; undefined for any other. */
  canonicalizeUrl(raw: string, input: TrackerUrlInput): string | undefined;
  /**
   * This tracker's read for one root: the shared deps and its own slot,
   * `undefined` when the root offers none. A tracker whose transport has
   * no default refuses; one with a default builds the read anyway.
   */
  createRead(
    shared: SharedRootDeps,
    transport: TrackerTransports[Kind] | undefined,
  ): Result<PrimaryRead, ConfigError>;
}
