import type { LookupAddress } from "node:dns";
import type { LinkFetchPolicy } from "generators";
import type { ProviderSnippet } from "../../types";

export interface BlockedSubnet {
  readonly prefix: string;
  readonly length: number;
}

/** Every A/AAAA record for a name. */
export type AddressResolver = (
  hostname: string,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: LookupAddress[],
  ) => void,
) => void;

/** The slice of a c-ares `Resolver` a lookup asks. */
export interface DnsRecordResolver {
  resolve4(
    hostname: string,
    callback: (error: NodeJS.ErrnoException | null, records: string[]) => void,
  ): void;
  resolve6(
    hostname: string,
    callback: (error: NodeJS.ErrnoException | null, records: string[]) => void,
  ): void;
  cancel(): void;
}

export interface LookupBounds {
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
}

export type FetchTextResult = { text: string } | { error: string };

export interface UrlContextProviderOptions {
  readonly linkFetch: LinkFetchPolicy;
  readonly resolveAddresses?: AddressResolver;
  /** The ports a link may name; production always takes `LINK_PORTS`. */
  readonly allowedPorts?: ReadonlySet<number>;
}

/** Linked snippets inside one prompt's character budget, and the sources it left out. */
export interface LinkedTextFit {
  readonly kept: ProviderSnippet[];
  readonly skipped: string[];
}
