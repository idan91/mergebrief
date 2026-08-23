// The thrown wire-error family: abstract `ApiError` + exactly one subclass
// per HTTP status in `API_ERROR_STATUS`. `CodeFor<status>` constrains each
// class to codes of its status, so class, status, and code can never
// disagree — the status table stays the single source of truth.
import type { ValueOf } from "types";
import type {
  API_ERROR_STATUS,
  ApiErrorCode,
  ApiErrorParams,
} from "../error-response";

export type ApiErrorStatus = ValueOf<typeof API_ERROR_STATUS>;

type ParamCode = keyof ApiErrorParams;

/** The codes whose pinned status is `S`. */
export type CodeFor<S extends ApiErrorStatus> = {
  [C in ApiErrorCode]: (typeof API_ERROR_STATUS)[C] extends S ? C : never;
}[ApiErrorCode];

// Some codes need extra data for their message (today only one:
// `generation-config` needs `{ detail }`). These two split a status's codes
// by that: `PlainCodeFor<S>` = the codes that take nothing, `ParamCodeFor<S>`
// = the codes that require their data. Each class builds its constructor
// overloads from the pair — `new ServiceUnavailable("generation-unavailable")`
// compiles with one argument, `new ServiceUnavailable("generation-config")`
// refuses to compile until you pass the `{ detail }`.
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
  override readonly status: 400;
  constructor(code: PlainCodeFor<400>);
  constructor(
    code: ParamCodeFor<400>,
    params: ApiErrorParams[ParamCodeFor<400>],
  );
  constructor(code: CodeFor<400>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 400;
  }
}

export class Unauthorized extends ApiError {
  override readonly status: 401;
  constructor(code: PlainCodeFor<401>);
  constructor(
    code: ParamCodeFor<401>,
    params: ApiErrorParams[ParamCodeFor<401>],
  );
  constructor(code: CodeFor<401>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 401;
  }
}

export class Forbidden extends ApiError {
  override readonly status: 403;
  constructor(code: PlainCodeFor<403>);
  constructor(
    code: ParamCodeFor<403>,
    params: ApiErrorParams[ParamCodeFor<403>],
  );
  constructor(code: CodeFor<403>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 403;
  }
}

export class NotFound extends ApiError {
  override readonly status: 404;
  constructor(code: PlainCodeFor<404>);
  constructor(
    code: ParamCodeFor<404>,
    params: ApiErrorParams[ParamCodeFor<404>],
  );
  constructor(code: CodeFor<404>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 404;
  }
}

export class Conflict extends ApiError {
  override readonly status: 409;
  constructor(code: PlainCodeFor<409>);
  constructor(
    code: ParamCodeFor<409>,
    params: ApiErrorParams[ParamCodeFor<409>],
  );
  constructor(code: CodeFor<409>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 409;
  }
}

export class PayloadTooLarge extends ApiError {
  override readonly status: 413;
  constructor(code: PlainCodeFor<413>);
  constructor(
    code: ParamCodeFor<413>,
    params: ApiErrorParams[ParamCodeFor<413>],
  );
  constructor(code: CodeFor<413>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 413;
  }
}

export class InternalError extends ApiError {
  override readonly status: 500;
  constructor(code: PlainCodeFor<500>);
  constructor(
    code: ParamCodeFor<500>,
    params: ApiErrorParams[ParamCodeFor<500>],
  );
  constructor(code: CodeFor<500>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 500;
  }
}

export class BadGateway extends ApiError {
  override readonly status: 502;
  constructor(code: PlainCodeFor<502>);
  constructor(
    code: ParamCodeFor<502>,
    params: ApiErrorParams[ParamCodeFor<502>],
  );
  constructor(code: CodeFor<502>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 502;
  }
}

export class ServiceUnavailable extends ApiError {
  override readonly status: 503;
  constructor(code: PlainCodeFor<503>);
  constructor(
    code: ParamCodeFor<503>,
    params: ApiErrorParams[ParamCodeFor<503>],
  );
  constructor(code: CodeFor<503>, params?: ApiErrorParams[ParamCode]) {
    super(code, params);
    this.status = 503;
  }
}
