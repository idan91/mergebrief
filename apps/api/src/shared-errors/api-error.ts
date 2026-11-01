// The thrown wire-error family: abstract `ApiError` + exactly one subclass
// per HTTP status in `ApiErrorStatusByCode`. `CodeFor<status>` constrains each
// class to codes of its status, so class, status, and code can never
// disagree, the status table stays the single source of truth.
import type { HttpStatuses, ValueOf } from "types";
import {
  ApiErrorCodes,
  type ApiErrorCode,
  type ApiErrorStatusByCode,
} from "contract";

export type ApiErrorStatus = ValueOf<typeof ApiErrorStatusByCode>;

/** The codes whose pinned status is `S`. */
export type CodeFor<S extends ApiErrorStatus> = {
  [C in ApiErrorCode]: (typeof ApiErrorStatusByCode)[C] extends S ? C : never;
}[ApiErrorCode];

// A class whose code IS its status restated defaults to it; a status whose
// codes are distinct reasons keeps the code required, since no reason is the
// obvious one.
export abstract class ApiError extends Error {
  readonly code: ApiErrorCode;

  protected constructor(code: ApiErrorCode) {
    super(code);
    this.name = new.target.name;
    this.code = code;
  }
}

export class BadRequest extends ApiError {
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.BAD_REQUEST
    > = ApiErrorCodes.INVALID_REQUEST,
  ) {
    super(code);
  }
}

export class Unauthorized extends ApiError {
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.UNAUTHORIZED
    > = ApiErrorCodes.UNAUTHORIZED,
  ) {
    super(code);
  }
}

export class Forbidden extends ApiError {
  public constructor(
    code: CodeFor<typeof HttpStatuses.FORBIDDEN> = ApiErrorCodes.FORBIDDEN,
  ) {
    super(code);
  }
}

export class NotFound extends ApiError {
  public constructor(
    code: CodeFor<typeof HttpStatuses.NOT_FOUND> = ApiErrorCodes.NOT_FOUND,
  ) {
    super(code);
  }
}

export class Conflict extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.CONFLICT>) {
    super(code);
  }
}

export class PayloadTooLarge extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>) {
    super(code);
  }
}

export class TooManyRequests extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.TOO_MANY_REQUESTS>) {
    super(code);
  }
}

export class InternalError extends ApiError {
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.INTERNAL_SERVER_ERROR
    > = ApiErrorCodes.INTERNAL_ERROR,
  ) {
    super(code);
  }
}

export class BadGateway extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.BAD_GATEWAY>) {
    super(code);
  }
}

export class ServiceUnavailable extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>) {
    super(code);
  }
}

export class GatewayTimeout extends ApiError {
  public constructor(code: CodeFor<typeof HttpStatuses.GATEWAY_TIMEOUT>) {
    super(code);
  }
}
