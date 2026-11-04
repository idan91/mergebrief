// Who may use this instance. Closed by default: an Operator or a listed user
// needs no GitHub call, and anyone else needs an installation of the App on a
// listed account. A personal account's id is its owner's user id, so an
// Operator's own account counts as listed. The lists arrive as values, so
// their source can change.
import { ApiErrorCodes } from "contract";
import { listUserInstallations, type UserInstallation } from "github";
import type { Result } from "types/utils";
import type {
  AccessibleInstallationsResolver,
  AccessibleSetFailure,
} from "../routes/auth/accessible-installations";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import {
  BadGateway,
  Forbidden,
  Unauthorized,
} from "../shared-errors/api-error";
import type { RequestGitHub } from "./reviewer-binding";
import { TokenAccessFailures, type TokenAccessFailure } from "./types";

export type InstanceAccessPolicy = Pick<
  AuthRouteDeps,
  "operatorIds" | "allowedAccess"
>;

export type InstanceAccessFailure =
  | { readonly kind: "not-allowed" }
  | AccessibleSetFailure;

export interface InstanceAccessCheck {
  check(request: RequestGitHub): Promise<Result<void, InstanceAccessFailure>>;
}

/** No file or an empty one names nobody: a mistake to survive, not a removal. */
export function namesAnyone({
  operatorIds,
  allowedAccess,
}: InstanceAccessPolicy): boolean {
  const named =
    (operatorIds?.size ?? 0) +
    (allowedAccess?.users.size ?? 0) +
    (allowedAccess?.accounts.size ?? 0);
  return named > 0;
}

function isNamedInConfig(
  policy: InstanceAccessPolicy,
  viewerId: bigint,
): boolean {
  if (policy.operatorIds?.has(viewerId) === true) {
    return true;
  }
  return policy.allowedAccess?.users.has(viewerId) === true;
}

function isAccountListed(
  policy: InstanceAccessPolicy,
  accountId: bigint,
): boolean {
  if (policy.operatorIds?.has(accountId) === true) {
    return true;
  }
  return policy.allowedAccess?.accounts.has(accountId) === true;
}

function reachesListedAccount(
  policy: InstanceAccessPolicy,
  installations: readonly UserInstallation[],
): boolean {
  return installations.some(({ accountId, suspended }) => {
    if (accountId === undefined) {
      return false;
    }
    const counts = suspended !== true && isAccountListed(policy, accountId);
    return counts;
  });
}

/** The request path's check, over the shared 60 s installation cache. */
export function createInstanceAccessCheck(
  policy: InstanceAccessPolicy,
  installations: AccessibleInstallationsResolver,
): InstanceAccessCheck {
  return {
    async check(request) {
      if (isNamedInConfig(policy, request.credential.session().reviewerId)) {
        return { ok: true, value: undefined };
      }
      const reachable = await installations.resolve(request);
      if (!reachable.ok) {
        return reachable;
      }
      if (!reachesListedAccount(policy, reachable.value.installations)) {
        return { ok: false, error: { kind: "not-allowed" } };
      }
      return { ok: true, value: undefined };
    },
  };
}

/** The same rule on a bare token: a sign-in or a rotation holds no request credential. */
export async function checkTokenAccess(
  policy: InstanceAccessPolicy,
  accessToken: string,
  viewerId: bigint,
): Promise<Result<void, TokenAccessFailure>> {
  if (isNamedInConfig(policy, viewerId)) {
    return { ok: true, value: undefined };
  }
  const listed = await listUserInstallations(accessToken);
  if (!listed.ok) {
    return { ok: false, error: TokenAccessFailures.UNAVAILABLE };
  }
  if (!reachesListedAccount(policy, listed.value)) {
    return { ok: false, error: TokenAccessFailures.NOT_ALLOWED };
  }
  return { ok: true, value: undefined };
}

/** A dead token is re-login, and an unanswered read fails closed. */
export function throwInstanceAccessFailure(
  failure: InstanceAccessFailure,
): never {
  if (failure.kind === "not-allowed") {
    throw new Forbidden(ApiErrorCodes.ACCOUNT_NOT_ALLOWED);
  }
  if (failure.kind === "auth-dead") {
    throw new Unauthorized();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
