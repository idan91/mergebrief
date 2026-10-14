// The wire catalog `GET /api/capabilities` serves. Byte-stable render: pretty
// JSON, trailing newline, operations sorted by id.
import { createHash } from "node:crypto";
import type { ProductOperationDescriptor } from "./types";

/** The wire catalog's fields; the descriptor's policy stays api-side. */
export interface CatalogOperation {
  readonly id: ProductOperationDescriptor["id"];
  readonly kind: ProductOperationDescriptor["kind"];
  readonly classification: ProductOperationDescriptor["classification"];
  readonly endpoint: ProductOperationDescriptor["endpoint"];
}

function compareById(left: CatalogOperation, right: CatalogOperation): number {
  return left.id.localeCompare(right.id);
}

/** Field order pinned here, not by descriptor construction order. */
export function shapeCatalogOperations(
  operations: readonly ProductOperationDescriptor[],
): CatalogOperation[] {
  return operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    classification: operation.classification,
    endpoint: operation.endpoint,
  }));
}

function renderCatalog(operations: readonly CatalogOperation[]): string {
  const rendered = `${JSON.stringify({ operations }, null, 2)}\n`;
  return rendered;
}

/** Identity of the rendered catalog bytes: the CLI's drift-detection key. */
export function computeCatalogFingerprint(
  operations: readonly ProductOperationDescriptor[],
): string {
  const rendered = renderCatalog(
    shapeCatalogOperations(operations).toSorted(compareById),
  );
  return createHash("sha256").update(rendered).digest("hex");
}
