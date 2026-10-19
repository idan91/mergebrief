import type {
  ActionClassification,
  OperationKinds,
  ProductEndpoint,
  ProductOperationId,
} from "contract";
import { AccessLevels, type AccessLevel } from "types";

// Ranks, not map order, are what the check compares; adding a rung means placing it here.
const ScopeRanks = {
  [AccessLevels.READ]: 0,
  [AccessLevels.PRIVATE_WRITE]: 1,
  [AccessLevels.EXTERNAL_WRITE]: 2,
} as const satisfies Record<AccessLevel, number>;

export function scopeReaches(
  scope: AccessLevel,
  classification: AccessLevel,
): boolean {
  return ScopeRanks[scope] >= ScopeRanks[classification];
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return Object.values(AccessLevels).some((known) => known === value);
}

/**
 * What the router enforces before an operation's handler runs, in the order
 * the fields are listed after the scope check. Every declaration states all
 * five: a route added later cannot inherit a permissive default by omission.
 */
export interface OperationPolicy {
  /**
   * Irreversible acts a browser confirm approves, and the reviewer's own risk
   * and draft decisions: an API token (CLI, agents) answers 403 `human-only`.
   */
  readonly browserSessionOnly: boolean;
  /**
   * Instance-wide state no repository access scopes, such as the day's
   * spend: a principal the config's `operators` list does not name answers
   * 403 `operator-only`, on a session or an API token alike.
   */
  readonly requiresOperator: boolean;
  /**
   * Replays GitHub's rule where the App's credential reads what only push
   * holders see (the collaborator list): 404 without push.
   */
  readonly requiresPushAccess: boolean;
  /**
   * The feature needs the App's credential or the Installation's stored pull
   * requests: a repo reached only by URL answers 404.
   */
  readonly requiresInstallation: boolean;
  /**
   * The per-PR access step loads the stored pull request (Installation or URL)
   * onto `pullRequestAccess` before the handler; none stored answers 404.
   */
  readonly requiresStoredPullRequest: boolean;
}

interface OperationDescriptorBase extends OperationPolicy {
  readonly id: ProductOperationId;
  readonly endpoint: ProductEndpoint;
}

export interface ProductQueryDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OperationKinds.QUERY;
  readonly classification: typeof AccessLevels.READ;
}

export interface ProductActionDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OperationKinds.ACTION;
  readonly classification: ActionClassification;
}

export type ProductOperationDescriptor =
  | ProductQueryDescriptor
  | ProductActionDescriptor;
