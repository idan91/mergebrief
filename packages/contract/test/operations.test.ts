import { describe, expect, expectTypeOf, it } from "vitest";
import {
  OperationKinds,
  ProductActionIds,
  ProductOperations,
  ProductQueryIds,
  formatProductEndpoint,
  type ProductEndpoint,
  type ProductOperationTable,
  type RouteEndpoint,
} from "../src/index";
import { HttpMethods } from "types/http";

const API_PREFIX = "/api";

describe("operation table", () => {
  it("holds one row per query id and per action id", () => {
    const ids = [
      ...Object.values(ProductQueryIds),
      ...Object.values(ProductActionIds),
    ];
    expect(Object.keys(ProductOperations).toSorted()).toEqual(ids.toSorted());
  });

  it("gives every query GET and every action a write method", () => {
    const rows = Object.values(ProductOperations);
    const queries = rows.filter((row) => row.kind === OperationKinds.QUERY);
    const actions = rows.filter((row) => row.kind === OperationKinds.ACTION);

    expect(queries.map((row) => row.method)).toEqual(
      queries.map(() => HttpMethods.GET),
    );
    expect(actions.map((row) => row.method)).not.toContain(HttpMethods.GET);
    expect(queries.length + actions.length).toBe(rows.length);
  });

  it("writes every path in full under the api prefix", () => {
    for (const row of Object.values(ProductOperations)) {
      expect(row.path.startsWith(`${API_PREFIX}/`)).toBe(true);
      expect(row.path.endsWith("/")).toBe(false);
    }
  });

  it("refuses a query id mapped to an action row at compile time", () => {
    const table = {
      ...ProductOperations,
      // @ts-expect-error a query id takes a query row, never an action row
      [ProductQueryIds.LIST_INBOX]:
        ProductOperations[ProductActionIds.SUBMIT_REVIEW],
    } satisfies ProductOperationTable;
    expect(table[ProductQueryIds.LIST_INBOX].kind).toBe(OperationKinds.ACTION);
  });

  it("types every row's endpoint as a known literal", () => {
    expectTypeOf<"DELETE /api/auth/sessions">().toExtend<ProductEndpoint>();
    expectTypeOf<"GET /api/made-up">().not.toExtend<ProductEndpoint>();
    expectTypeOf<"POST /api/inbox">().not.toExtend<ProductEndpoint>();
    expectTypeOf<ProductEndpoint>().toExtend<RouteEndpoint>();
    expectTypeOf<"get /api/inbox">().not.toExtend<RouteEndpoint>();
  });

  it("formats a row's endpoint as its method and full path", () => {
    expect(formatProductEndpoint(ProductActionIds.REVOKE_SESSIONS)).toBe(
      "DELETE /api/auth/sessions",
    );
    const ids = [
      ...Object.values(ProductQueryIds),
      ...Object.values(ProductActionIds),
    ];
    for (const id of ids) {
      const row = ProductOperations[id];
      expect(formatProductEndpoint(id)).toBe(`${row.method} ${row.path}`);
    }
  });
});
