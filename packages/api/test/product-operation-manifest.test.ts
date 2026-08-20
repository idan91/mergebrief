// The manifest render and its drift pin: the committed
// `product-operations.manifest.json` must byte-equal what the registry
// renders, so an unregistered route or edited descriptor fails the suite
// (and CI) until the file is regenerated.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EmptyCatalogError,
  renderManifest,
} from "../src/product-operations/manifest";
import { productOperationRegistry } from "../src/product-operations/registry";
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
