import type { Result } from "types";
import type { ConfigError } from "generators";
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
import type { IssueReader } from "./github/issue-read";

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
  /** Whether a Notion token is configured; Notion URLs match only then. */
  readonly notion: boolean;
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

/**
 * What a composition root can offer a tracker's read. A tracker takes what
 * it needs and refuses at boot when that is missing; a new tracker that
 * needs something no root offers yet adds one field here.
 */
export interface TrackerRootDeps {
  /** Tokens are resolved from here by NAME; roots stay the only `process.env` readers. */
  readonly env: Record<string, string | undefined>;
  /** GitHub's transport: the installation client at the worker, `gh` at the CLIs. */
  readonly github?: { readonly issueReader: IssueReader } | undefined;
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
 * form, and how to build its read for a root. `trackers/index.ts` lists
 * them; a new tracker is a module here plus a line there.
 */
export interface Tracker {
  readonly kind: TicketTracker;
  /** This tracker's references in one location's text, offsets kept. */
  collectReferences(
    text: string,
    location: ReferenceLocation,
    input: TicketReferenceInput,
  ): ReferenceHit[];
  /** The canonical form of a URL this tracker owns; undefined for any other. */
  canonicalizeUrl(raw: string): string | undefined;
  /** This tracker's read for one root; refuses when the root lacks what it needs. */
  createRead(root: TrackerRootDeps): Result<PrimaryRead, ConfigError>;
}
