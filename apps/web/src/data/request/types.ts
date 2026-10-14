import type { ProductOperationId, ProductOperations } from "contract";
import type { ValueOf } from "types/utils";

import type { ApiErrorCode } from "../apiFetch";

/** The failure kinds every write shares, beside the kinds its own table names. */
export const WriteFailureKinds = {
  UNAUTHORIZED: "unauthorized",
  /** A network throw or the proxy's 504: the write may or may not have landed. */
  INDETERMINATE: "indeterminate",
} as const;
export type WriteFailureKind = ValueOf<typeof WriteFailureKinds>;

type FreeKey<Key extends string> = Key extends ApiErrorCode ? never : Key;

/**
 * A write's code-to-kind table: only the codes whose kind differs from
 * `fallback`. The `fallback` key is mapped through `FreeKey`, so a wire code
 * of that name would remove it and break every table at compile time.
 */
export type WriteKindTable<Kind extends string> = Partial<
  Record<ApiErrorCode, Kind>
> & { readonly [Key in FreeKey<"fallback">]: Kind };

type PathParamNames<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | PathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never;

type OperationPath<Id extends ProductOperationId> =
  (typeof ProductOperations)[Id]["path"];

/** The `:name` segments of the operation's path, each filled by the caller. */
type OperationParams<Id extends ProductOperationId> = {
  readonly [Name in PathParamNames<OperationPath<Id>>]: string | number;
};

export interface ApiRequest<Id extends ProductOperationId> {
  readonly params: OperationParams<Id>;
  /** An `undefined` value is left off the URL. */
  readonly query?: Readonly<Record<string, string | undefined>>;
  /** A `Blob` goes as-is under its own type; anything else is JSON. */
  readonly body?: object | Blob;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly unauthorizedIsSignedOut?: boolean;
  readonly unauthorizedLeavesForSignIn?: boolean;
}
