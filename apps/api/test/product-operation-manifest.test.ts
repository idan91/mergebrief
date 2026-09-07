// The manifest render and its drift pin: the committed
// `product-operations.manifest.json` must byte-equal what the registry
// renders, so an unregistered route or edited descriptor fails the suite
// (and CI) until the file is regenerated.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeCatalogFingerprint,
  EmptyCatalogError,
  renderManifest,
} from "../src/product-operations/manifest";
import {
  createProductOperationRegistry,
  productOperationRegistry,
} from "../src/product-operations/registry";
import { composeCatalog } from "./compose-catalog";

const MANIFEST_PATH = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "product-operations.manifest.json",
);

describe("product operation manifest", () => {
  it("renders a stable, pretty-printed envelope with a trailing newline", () => {
    const rendered = renderManifest([
      {
        id: "probe-op",
        kind: "query",
        classification: "read",
        endpoint: "GET /api/probe",
      },
    ]);
    expect(rendered).toBe(
      `${JSON.stringify(
        {
          operations: [
            {
              id: "probe-op",
              kind: "query",
              classification: "read",
              endpoint: "GET /api/probe",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("refuses to render an empty catalog", () => {
    expect(() => renderManifest([])).toThrow(EmptyCatalogError);
    expect(() => renderManifest([])).toThrow(
      "composition registered no product operations",
    );
  });

  it("committed manifest byte-equals the registry render (no drift)", async () => {
    const { harness } = await composeCatalog();
    try {
      const committed = readFileSync(MANIFEST_PATH, "utf8");
      expect(committed).toBe(renderManifest(productOperationRegistry.list()));
    } finally {
      await harness.close();
    }
  });
});

describe("computeCatalogFingerprint", () => {
  const probe = {
    id: "probe-op",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/probe",
  } as const;
  const other = {
    id: "other-op",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/other",
  } as const;

  it("is the sha256 hex of the rendered manifest bytes", () => {
    expect(computeCatalogFingerprint([probe])).toBe(
      createHash("sha256")
        .update(renderManifest([probe]))
        .digest("hex"),
    );
  });

  it("is insensitive to registration order through the registry", () => {
    // The render preserves input order; the sort lives in registry.list().
    const oneOrder = createProductOperationRegistry();
    oneOrder.register(probe);
    oneOrder.register(other);
    const otherOrder = createProductOperationRegistry();
    otherOrder.register(other);
    otherOrder.register(probe);
    expect(computeCatalogFingerprint(oneOrder.list())).toBe(
      computeCatalogFingerprint(otherOrder.list()),
    );
  });

  it("changes when any descriptor field changes", () => {
    const moved = { ...probe, endpoint: "GET /api/probe2" } as const;
    expect(computeCatalogFingerprint([moved])).not.toBe(
      computeCatalogFingerprint([probe]),
    );
  });
});
