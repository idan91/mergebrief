import type { Logger } from "logging";
import { createGrantAuth } from "persistence";
import type { Result } from "types/utils";
import {
  RefreshErrorCodes,
  RotationFailures,
  type AuthRouteDeps,
  type RefreshError,
  type RefreshedSession,
  type RotationRejection,
  type ViewerPrincipal,
} from "../types";

type RefreshFailure = Result<RefreshedSession, RefreshError>;

/** Both channels end: the grant's refresh token is spent for good. */
async function retireDeadGrant(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): Promise<RefreshFailure> {
  await createGrantAuth(deps.handle).retireGrant(session.grantId, new Date());
  log.error("GitHub refused the grant's refresh token; grant retired", {
    evt: "token.refresh.fail",
    reviewerId: String(session.reviewerId),
  });
  return {
    ok: false,
    error: {
      code: RefreshErrorCodes.GRANT_DEAD,
      message: "refresh token refused; re-authentication required",
    },
  };
}

/**
 * `refreshTokenPossiblyConsumed` marks a call GitHub may have rotated before
 * it failed: a later retirement of the same grant is then this request's doing.
 */
function reportUnavailable(
  session: ViewerPrincipal,
  log: Logger,
  message: string,
  refreshTokenPossiblyConsumed: boolean,
): RefreshFailure {
  log.warn(message, {
    evt: "token.refresh.unavailable",
    reviewerId: String(session.reviewerId),
    refreshTokenPossiblyConsumed,
  });
  return {
    ok: false,
    error: {
      code: RefreshErrorCodes.UNAVAILABLE,
      message: "GitHub did not answer the token refresh",
    },
  };
}

const CRYPTO_FAILURE: RefreshFailure = {
  ok: false,
  error: {
    code: RefreshErrorCodes.CRYPTO_FAILED,
    message: "the grant's tokens could not be opened or sealed",
  },
};

/** Same event and fields as the credential's own unreadable-token line. */
function reportDecryptFailure(
  session: ViewerPrincipal,
  log: Logger,
): RefreshFailure {
  log.error("the session key could not open the grant's stored token", {
    evt: "token.decrypt.fail",
    reviewerId: String(session.reviewerId),
  });
  return CRYPTO_FAILURE;
}

function reportSealFailure(
  session: ViewerPrincipal,
  log: Logger,
): RefreshFailure {
  log.error("the session key could not seal the rotated tokens", {
    evt: "token.refresh.fail",
    reviewerId: String(session.reviewerId),
    kind: RotationFailures.SEAL_FAILED,
  });
  return CRYPTO_FAILURE;
}

function reportClientMisconfigured(
  session: ViewerPrincipal,
  clientError: string | undefined,
  log: Logger,
): RefreshFailure {
  log.error("GitHub refused the App's OAuth credentials or settings", {
    evt: "token.refresh.fail",
    reviewerId: String(session.reviewerId),
    kind: clientError,
  });
  return {
    ok: false,
    error: {
      code: RefreshErrorCodes.CLIENT_MISCONFIGURED,
      message: "GitHub refused the App's OAuth credentials or settings",
    },
  };
}

/**
 * Only GitHub refusing the reviewer's refresh token touches a row. An outage,
 * a key problem or a refusal of the App's own settings keeps every session
 * and token, so none of them logs anybody out.
 */
export function answerRotationFailure(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  rejection: RotationRejection,
  log: Logger,
): Promise<RefreshFailure> {
  switch (rejection.reason) {
    case RotationFailures.GITHUB_REJECTED: {
      return retireDeadGrant(deps, session, log);
    }
    case RotationFailures.GITHUB_UNAVAILABLE: {
      return Promise.resolve(
        reportUnavailable(
          session,
          log,
          "GitHub did not answer the token refresh",
          true,
        ),
      );
    }
    case RotationFailures.GRANT_BUSY: {
      return Promise.resolve(
        reportUnavailable(
          session,
          log,
          "another refresh held the grant past the lock bound",
          false,
        ),
      );
    }
    case RotationFailures.DECRYPT_FAILED: {
      return Promise.resolve(reportDecryptFailure(session, log));
    }
    case RotationFailures.SEAL_FAILED: {
      return Promise.resolve(reportSealFailure(session, log));
    }
    case RotationFailures.CLIENT_MISCONFIGURED: {
      return Promise.resolve(
        reportClientMisconfigured(session, rejection.clientError, log),
      );
    }
  }
}
