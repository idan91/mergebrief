// The thrown wire-error family: abstract `ApiError` + exactly one subclass
// per HTTP status in `ApiErrorStatusByCode`. `CodeFor<status>` constrains each
// class to codes of its status, so class, status, and code can never
// disagree, the status table stays the single source of truth.
import type { HttpStatuses, ValueOf } from "types";
import {
  ApiErrorCodes,
  type ApiErrorCode,
  type ApiErrorParams,
  type ApiErrorStatusByCode,
} from "contract";

export type ApiErrorStatus = ValueOf<typeof ApiErrorStatusByCode>;

type ParamCode = keyof ApiErrorParams;

/** The codes whose pinned status is `S`. */
export type CodeFor<S extends ApiErrorStatus> = {
  [C in ApiErrorCode]: (typeof ApiErrorStatusByCode)[C] extends S ? C : never;
}[ApiErrorCode];

// A class whose code IS its status restated defaults to it; a status whose
// codes are distinct reasons keeps the code required, since no reason is the
// obvious one. These two split a status's codes by whether the message needs
// extra data: `PlainCodeFor<S>` takes nothing, `ParamCodeFor<S>` requires it.
// Each class builds its constructor overloads from the pair, so
// `new ServiceUnavailable("generation-unavailable")` compiles with one
// argument and `new ServiceUnavailable("generation-config")` refuses until
// you pass the `{ detail }`.
type PlainCodeFor<S extends ApiErrorStatus> = Exclude<CodeFor<S>, ParamCode>;
type ParamCodeFor<S extends ApiErrorStatus> = Extract<CodeFor<S>, ParamCode>;

export abstract class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams[ParamCode] | undefined;

  protected constructor(
    code: ApiErrorCode,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code);
    this.name = new.target.name;
    this.code = code;
    this.params = params;
  }
}

export class BadRequest extends ApiError {
  public constructor(code?: PlainCodeFor<typeof HttpStatuses.BAD_REQUEST>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.BAD_REQUEST>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.BAD_REQUEST>],
  );
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.BAD_REQUEST
    > = ApiErrorCodes.INVALID_REQUEST,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class Unauthorized extends ApiError {
  public constructor(code?: PlainCodeFor<typeof HttpStatuses.UNAUTHORIZED>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.UNAUTHORIZED>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.UNAUTHORIZED>],
  );
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.UNAUTHORIZED
    > = ApiErrorCodes.UNAUTHORIZED,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class Forbidden extends ApiError {
  public constructor(code?: PlainCodeFor<typeof HttpStatuses.FORBIDDEN>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.FORBIDDEN>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.FORBIDDEN>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.FORBIDDEN> = ApiErrorCodes.FORBIDDEN,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class NotFound extends ApiError {
  public constructor(code?: PlainCodeFor<typeof HttpStatuses.NOT_FOUND>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.NOT_FOUND>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.NOT_FOUND>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.NOT_FOUND> = ApiErrorCodes.NOT_FOUND,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class Conflict extends ApiError {
  public constructor(code: PlainCodeFor<typeof HttpStatuses.CONFLICT>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.CONFLICT>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.CONFLICT>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.CONFLICT>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class PayloadTooLarge extends ApiError {
  public constructor(code: PlainCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class TooManyRequests extends ApiError {
  public constructor(code: PlainCodeFor<typeof HttpStatuses.TOO_MANY_REQUESTS>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.TOO_MANY_REQUESTS>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.TOO_MANY_REQUESTS>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.TOO_MANY_REQUESTS>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class InternalError extends ApiError {
  public constructor(
    code?: PlainCodeFor<typeof HttpStatuses.INTERNAL_SERVER_ERROR>,
  );
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.INTERNAL_SERVER_ERROR>,
    params: ApiErrorParams[ParamCodeFor<
      typeof HttpStatuses.INTERNAL_SERVER_ERROR
    >],
  );
  public constructor(
    code: CodeFor<
      typeof HttpStatuses.INTERNAL_SERVER_ERROR
    > = ApiErrorCodes.INTERNAL_ERROR,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class BadGateway extends ApiError {
  public constructor(code: PlainCodeFor<typeof HttpStatuses.BAD_GATEWAY>);
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.BAD_GATEWAY>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.BAD_GATEWAY>],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.BAD_GATEWAY>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}

export class ServiceUnavailable extends ApiError {
  public constructor(
    code: PlainCodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>,
  );
  public constructor(
    code: ParamCodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>,
    params: ApiErrorParams[ParamCodeFor<
      typeof HttpStatuses.SERVICE_UNAVAILABLE
    >],
  );
  public constructor(
    code: CodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
  }
}
