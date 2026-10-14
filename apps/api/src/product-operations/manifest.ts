// Renders the committed manifest, the machine-readable capability surface
// consumers read instead of importing route code. Byte-stable: pretty JSON,
// trailing newline, operations in the registry's sorted order.
import { createHash } from "node:crypto";
import type { ProductOperationDescriptor } from "./types";

/**
 * An empty catalog is never a legitimate render: route files declare
 * operations, so zero of them means composition did not run, not that the
 * surface is empty. Thrown rather than returned: a manifest written from an
 * empty registry would make every later drift check pass against nothing.
 */
export class EmptyCatalogError extends Error {
  constructor() {
    super("composition registered no product operations");
    this.name = "EmptyCatalogError";
  }
}

/** The wire catalog's fields; the descriptor's policy stays api-side. */
export interface CatalogOperation {
  readonly id: ProductOperationDescriptor["id"];
  readonly kind: ProductOperationDescriptor["kind"];
  readonly classification: ProductOperationDescriptor["classification"];
  readonly endpoint: ProductOperationDescriptor["endpoint"];
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

export function renderManifest(
  operations: readonly ProductOperationDescriptor[],
): string {
  if (operations.length === 0) {
    throw new EmptyCatalogError();
  }
  const normalized = shapeCatalogOperations(operations);
  return `${JSON.stringify({ operations: normalized }, null, 2)}\n`;
}

/** Identity of the rendered manifest bytes: the CLI's drift-detection key. */
export function computeCatalogFingerprint(
  operations: readonly ProductOperationDescriptor[],
): string {
  return createHash("sha256").update(renderManifest(operations)).digest("hex");
}
