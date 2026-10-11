import type { ValueOf } from "types/utils";
import type {
  GitHubCall,
  GitHubReader,
  InstallationGitHub,
  InstallationRepoClient,
  ReviewerGitHub,
  ReviewerRepoClient,
} from "../../../src/client/types";

/** Every method a binding exposes, named as the interfaces name it. */
export type ContractOperation = Exclude<
  | keyof ReviewerRepoClient
  | keyof InstallationRepoClient
  | keyof ReviewerGitHub,
  "forRepo"
>;

/** How GitHub answers the arranged operation. */
export const ContractOutcomes = {
  OK: "ok",
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  SERVER_ERROR: "server-error",
} as const;
export type ContractOutcome = ValueOf<typeof ContractOutcomes>;

export interface ContractArrangement {
  readonly operation: ContractOperation;
  readonly outcome: ContractOutcome;
}

/**
 * The three bindings over one arranged GitHub. Under `OK` the arranged
 * operation answers the value its case expects; the reviewer's credential
 * cannot renew, so a 401 is final.
 */
export interface ContractAdapter {
  readonly reviewer: ReviewerGitHub;
  readonly installation: InstallationGitHub;
  readonly operator: GitHubReader;
  /** Requests GitHub received for the operation, token minting excluded. */
  countRequests(): number;
}

export type ContractAdapterFactory = (
  arrangement: ContractArrangement,
) => ContractAdapter;

export interface ContractCase<Client> {
  readonly operation: ContractOperation;
  readonly call: (client: Client) => GitHubCall<unknown>;
  readonly expected: unknown;
  /** The value a 404 folds to; absent when a 404 answers `not-found`. */
  readonly notFound?: unknown;
  /** A create reaches GitHub once, a 5xx included. */
  readonly create?: boolean;
}

export interface TypedContractCase<Client, Value> {
  readonly operation: ContractOperation;
  readonly call: (client: Client) => GitHubCall<Value>;
  readonly expected: NoInfer<Value>;
  readonly notFound?: NoInfer<Value>;
  readonly create?: boolean;
}
