import type {
  ReferenceLocation,
  TicketTracker,
  TrackerConfig,
} from "../tracker";

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
 * One tracker's syntax: how its references look in PR text and how its URLs
 * canonicalize. A tracker's read lives in the same module once it has one.
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
}
