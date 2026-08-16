// The catalog seam: descriptors, registry semantics (duplicate/invalid id =
// programmer error = throw), and the registrar calls route files make at
// module load — one call per operation, factories never touched.
import { describe, expect, it } from "vitest";
import {
  createProductOperationRegistry,
  productOperationRegistry,
} from "../src/product-operations/registry";
import {
  createProductOperationRegistrars,
  registerProductAction,
  registerProductQuery,
} from "../src/product-operations/registrars";
import {
  OPERATION_KIND,
  WRITE_CLASSIFICATION,
} from "../src/product-operations/types";

describe("product operation registry", () => {
  it("enumerates registered descriptors sorted by id", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "list-pulls",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    registry.register({
      id: "generate-brief",
      kind: OPERATION_KIND.ACTION,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      agentAvailable: true,
    });
    expect(registry.list().map((d) => d.id)).toEqual([
      "generate-brief",
      "list-pulls",
    ]);
  });

  it("returns descriptors with their full audited shape", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "mint-token",
      kind: OPERATION_KIND.ACTION,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      agentAvailable: false,
    });
    expect(registry.list()).toEqual([
      {
        id: "mint-token",
        kind: "action",
        classification: "private-write",
        agentAvailable: false,
      },
    ]);
  });

  it("throws on a duplicate id", () => {
    const registry = createProductOperationRegistry();
    const descriptor = {
      id: "list-pulls",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    } as const;
    registry.register(descriptor);
    expect(() => registry.register(descriptor)).toThrowError(/list-pulls/);
  });

  it.each(["ListPulls", "list_pulls", "list pulls", "", "-lead", "trail-"])(
    "throws on a non-kebab-case id: %j",
    (id) => {
      const registry = createProductOperationRegistry();
      expect(() =>
        registry.register({
          id,
          kind: OPERATION_KIND.QUERY,
          classification: WRITE_CLASSIFICATION.READ,
          agentAvailable: true,
        }),
      ).toThrowError(/kebab-case/);
    },
  );

  it("list() is a snapshot — later registrations do not mutate it", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "a-op",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    const snapshot = registry.list();
    registry.register({
      id: "b-op",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    expect(snapshot).toHaveLength(1);
  });
});

function registrarsOnFreshRegistry() {
  const registry = createProductOperationRegistry();
  return { registry, ...createProductOperationRegistrars(registry) };
}

describe("product operation registrars", () => {
  it("registerProductQuery stamps kind=query", () => {
    const { registry, registerProductQuery: register } =
      registrarsOnFreshRegistry();
    register({
      id: "list-repos",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    expect(registry.list()).toEqual([
      {
        id: "list-repos",
        kind: "query",
        classification: "read",
        agentAvailable: true,
      },
    ]);
  });

  it("registerProductAction stamps kind=action for both write classifications", () => {
    const { registry, registerProductAction: register } =
      registrarsOnFreshRegistry();
    register({
      id: "submit-review",
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
      agentAvailable: true,
    });
    register({
      id: "select-installation",
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      agentAvailable: true,
    });
    expect(
      registry.list().map((d) => [d.id, d.kind, d.classification]),
    ).toEqual([
      ["select-installation", "action", "private-write"],
      ["submit-review", "action", "external-write"],
    ]);
  });

  it("a multi-operation factory registers with one call per operation", () => {
    const { registry, registerProductQuery: register } =
      registrarsOnFreshRegistry();
    register({
      id: "read-brief",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    register({
      id: "read-diff",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    expect(registry.list().map((d) => d.id)).toEqual([
      "read-brief",
      "read-diff",
    ]);
  });

  it("a factory serving a query and an action registers one of each", () => {
    const {
      registry,
      registerProductQuery: query,
      registerProductAction: action,
    } = registrarsOnFreshRegistry();
    query({
      id: "read-conversation",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    action({
      id: "reply-to-comment",
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
      agentAvailable: true,
    });
    expect(registry.list().map((d) => [d.id, d.kind])).toEqual([
      ["read-conversation", "query"],
      ["reply-to-comment", "action"],
    ]);
  });

  it("duplicate id across registrar calls throws at call time", () => {
    const { registerProductQuery: register } = registrarsOnFreshRegistry();
    const descriptor = {
      id: "list-pulls",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    } as const;
    register(descriptor);
    expect(() => register(descriptor)).toThrowError(/list-pulls/);
  });

  it("the shared registrars register into the shared registry", () => {
    registerProductQuery({
      id: "shared-registry-probe",
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    });
    registerProductAction({
      id: "shared-registry-action-probe",
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      agentAvailable: true,
    });
    const ids = productOperationRegistry.list().map((d) => d.id);
    expect(ids).toContain("shared-registry-probe");
    expect(ids).toContain("shared-registry-action-probe");
  });

  it("rejects wrong classifications at compile time and at runtime", () => {
    const { registerProductQuery: query, registerProductAction: action } =
      registrarsOnFreshRegistry();
    expect(() =>
      query({
        id: "bad-query",
        // @ts-expect-error — a query must declare READ, not a write classification
        classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
        agentAvailable: true,
      }),
    ).toThrowError(/bad-query/);
    expect(() =>
      action({
        id: "bad-action",
        // @ts-expect-error — an action must declare a write classification, not READ
        classification: WRITE_CLASSIFICATION.READ,
        agentAvailable: true,
      }),
    ).toThrowError(/bad-action/);
  });
});
