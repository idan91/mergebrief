// Renders the committed manifest — the machine-readable capability surface
// consumers read instead of importing route code. Byte-stable: pretty JSON,
// trailing newline, operations in the registry's sorted order.
import type { ProductOperationDescriptor } from "./types";

/**
 * An empty catalog is never a legitimate render: route files declare
 * operations, so zero of them means composition did not run, not that the
 * surface is empty. Thrown rather than returned — a manifest written from an
 * empty registry would make every later drift check pass against nothing.
 */
export class EmptyCatalogError extends Error {
  constructor() {
    super("composition registered no product operations");
    this.name = "EmptyCatalogError";
  }
}

export function renderManifest(
  operations: readonly ProductOperationDescriptor[],
): string {
  if (operations.length === 0) {
    throw new EmptyCatalogError();
  }
  // Field order pinned here, not by descriptor construction order.
  const normalized = operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    classification: operation.classification,
    agentAvailable: operation.agentAvailable,
    endpoint: operation.endpoint,
  }));
  return `${JSON.stringify({ operations: normalized }, null, 2)}\n`;
}
