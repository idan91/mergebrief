// The thrown wire-error family: abstract `ApiError` + exactly one subclass
// per HTTP status in `ApiErrorStatusByCode`. `CodeFor<status>` constrains each
// class to codes of its status, so class, status, and code can never
// disagree, the status table stays the single source of truth.
import { HttpStatuses, type ValueOf } from "types";
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
  abstract readonly status: ApiErrorStatus;
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
  override readonly status: typeof HttpStatuses.BAD_REQUEST;
  constructor(code?: PlainCodeFor<typeof HttpStatuses.BAD_REQUEST>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.BAD_REQUEST>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.BAD_REQUEST>],
  );
  constructor(
    code: CodeFor<
      typeof HttpStatuses.BAD_REQUEST
    > = ApiErrorCodes.INVALID_REQUEST,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.BAD_REQUEST;
  }
}

export class Unauthorized extends ApiError {
  override readonly status: typeof HttpStatuses.UNAUTHORIZED;
  constructor(code?: PlainCodeFor<typeof HttpStatuses.UNAUTHORIZED>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.UNAUTHORIZED>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.UNAUTHORIZED>],
  );
  constructor(
    code: CodeFor<
      typeof HttpStatuses.UNAUTHORIZED
    > = ApiErrorCodes.UNAUTHORIZED,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.UNAUTHORIZED;
  }
}

export class Forbidden extends ApiError {
  override readonly status: typeof HttpStatuses.FORBIDDEN;
  constructor(code?: PlainCodeFor<typeof HttpStatuses.FORBIDDEN>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.FORBIDDEN>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.FORBIDDEN>],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.FORBIDDEN> = ApiErrorCodes.FORBIDDEN,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.FORBIDDEN;
  }
}

export class NotFound extends ApiError {
  override readonly status: typeof HttpStatuses.NOT_FOUND;
  constructor(code?: PlainCodeFor<typeof HttpStatuses.NOT_FOUND>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.NOT_FOUND>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.NOT_FOUND>],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.NOT_FOUND> = ApiErrorCodes.NOT_FOUND,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.NOT_FOUND;
  }
}

export class Conflict extends ApiError {
  override readonly status: typeof HttpStatuses.CONFLICT;
  constructor(code: PlainCodeFor<typeof HttpStatuses.CONFLICT>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.CONFLICT>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.CONFLICT>],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.CONFLICT>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.CONFLICT;
  }
}

export class PayloadTooLarge extends ApiError {
  override readonly status: typeof HttpStatuses.PAYLOAD_TOO_LARGE;
  constructor(code: PlainCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.PAYLOAD_TOO_LARGE>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.PAYLOAD_TOO_LARGE;
  }
}

export class InternalError extends ApiError {
  override readonly status: typeof HttpStatuses.INTERNAL_SERVER_ERROR;
  constructor(code?: PlainCodeFor<typeof HttpStatuses.INTERNAL_SERVER_ERROR>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.INTERNAL_SERVER_ERROR>,
    params: ApiErrorParams[ParamCodeFor<
      typeof HttpStatuses.INTERNAL_SERVER_ERROR
    >],
  );
  constructor(
    code: CodeFor<
      typeof HttpStatuses.INTERNAL_SERVER_ERROR
    > = ApiErrorCodes.INTERNAL_ERROR,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.INTERNAL_SERVER_ERROR;
  }
}

export class BadGateway extends ApiError {
  override readonly status: typeof HttpStatuses.BAD_GATEWAY;
  constructor(code: PlainCodeFor<typeof HttpStatuses.BAD_GATEWAY>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.BAD_GATEWAY>,
    params: ApiErrorParams[ParamCodeFor<typeof HttpStatuses.BAD_GATEWAY>],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.BAD_GATEWAY>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.BAD_GATEWAY;
  }
}

export class ServiceUnavailable extends ApiError {
  override readonly status: typeof HttpStatuses.SERVICE_UNAVAILABLE;
  constructor(code: PlainCodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>);
  constructor(
    code: ParamCodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>,
    params: ApiErrorParams[ParamCodeFor<
      typeof HttpStatuses.SERVICE_UNAVAILABLE
    >],
  );
  constructor(
    code: CodeFor<typeof HttpStatuses.SERVICE_UNAVAILABLE>,
    params?: ApiErrorParams[ParamCode],
  ) {
    super(code, params);
    this.status = HttpStatuses.SERVICE_UNAVAILABLE;
  }
}
