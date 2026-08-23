import { describe, expect, it } from "vitest";
import { computeCatalogFingerprint } from "../../product-operations/manifest";
import {
  OPERATION_KIND,
  WRITE_CLASSIFICATION,
  type ProductOperationDescriptor,
} from "../../product-operations/types";
import capabilitiesController from "./controller";

const OPERATIONS: readonly ProductOperationDescriptor[] = [
  {
    id: "read-capabilities",
    kind: OPERATION_KIND.QUERY,
    classification: WRITE_CLASSIFICATION.READ,
    endpoint: "GET /api/capabilities",
  },
];

describe("capabilitiesController.buildCapabilities", () => {
  it("returns the descriptors verbatim with the catalog fingerprint", () => {
    const body = capabilitiesController.buildCapabilities(OPERATIONS);
    expect(body.operations).toBe(OPERATIONS);
    expect(body.catalogFingerprint).toBe(computeCatalogFingerprint(OPERATIONS));
  });
});
