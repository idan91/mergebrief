// An operation's path filled from its row: every client builds a request
// URL here, so no client writes a path by hand.
import { ProductOperations } from "./operations";
import type { ProductOperationId } from "./operations/types";

type PathParamNames<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | PathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never;

type OperationPath<Id extends ProductOperationId> =
  (typeof ProductOperations)[Id]["path"];

/** The `:name` segments of the operation's path, each filled by the caller. */
export type OperationParams<Id extends ProductOperationId> = {
  readonly [Name in PathParamNames<OperationPath<Id>>]: string | number;
};

const PATH_PARAM = /:([A-Za-z]+)/g;

// `encodeURIComponent` leaves these intact, and URL parsing would collapse
// them into a different route.
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

/** The row's path with every param encoded; a missing or dot-segment param throws. */
export function buildOperationPath<Id extends ProductOperationId>(
  id: Id,
  params: OperationParams<Id>,
): string {
  const template = ProductOperations[id].path;
  const values: Readonly<Record<string, string | number>> = params;
  return template.replace(PATH_PARAM, (segment: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`missing path param ${segment} for ${template}`);
    }
    const encoded = encodeURIComponent(String(value));
    if (DOT_SEGMENTS.has(encoded)) {
      throw new Error(`path param ${segment} cannot be a dot segment`);
    }
    return encoded;
  });
}
