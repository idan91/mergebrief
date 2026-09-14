import type { Result } from "types/utils";
import type { ConfigError, ContextSourcesConfig } from "generators";
import type {
  ReferenceLocation,
  TicketTracker,
  TrackerConfig,
} from "../tracker";
import type {
  ContextProviderDeps,
  ContextReadFailure,
  PrimarySnippet,
} from "../types";
import type { GitHubTransport } from "./github/transport";
import type { NotionTransport } from "./notion/transport";

export interface TicketReferenceRepo {
  readonly owner: string;
  readonly repo: string;
}

/** The pure parser's input: PR text plus what the deployment can resolve. */
export interface TicketReferenceInput {
  readonly title: string;
  readonly body: string;
  /** Head branch name; "" when unknown. */
  readonly branch: string;
  /** The PR's own repo: where a bare `#N` resolves without `issuesRepo`. */
  readonly repo: TicketReferenceRepo;
  /** The repo's `tracker:` block; absent means keys never match. */
  readonly tracker?: TrackerConfig | undefined;
  /** The trackers this root can read; a tracker whose URLs are plain links without a read checks for its kind here. */
  readonly readable: readonly TicketTracker[];
}

export interface TicketReference {
  readonly tracker: TicketTracker;
  /** `PREFIX-N` for a key reference, else "". */
  readonly key: string;
  /** GitHub issue number; absent for Notion. */
  readonly number?: number;
  /** Notion page id (32 hex); absent for GitHub and for a Notion key. */
  readonly pageId?: string;
  /** The board a Notion key resolves in; absent for GitHub and page URLs. */
  readonly databaseId?: string;
  /** Canonical URL; "" for a Notion key until the provider resolves it. */
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

/** What every root offers every tracker: tokens by NAME from `env`, and the instance config's `contextSources:` entries. */
export interface SharedRootDeps {
  readonly env: Record<string, string | undefined>;
  readonly contextSources: ContextSourcesConfig;
}

/**
 * Each tracker's own transport, declared in its module and registered here
 * under its `TicketTracker` kind; a kind without a line fails to compile. A
 * new tracker adds one line; nothing that resolves a read changes.
 */
export interface TrackerTransports {
  readonly github: GitHubTransport;
  readonly notion: NotionTransport;
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
  canonicalizeUrl(raw: string): string | undefined;
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
