import { describe, expect, it } from "vitest";
import { computeCatalogFingerprint } from "../../product-operations/manifest";
import { WriteClassifications } from "persistence";
import {
  OperationKinds,
  type ProductOperationDescriptor,
} from "../../product-operations/types";
import capabilitiesController from "./controller";

const OPERATIONS: readonly ProductOperationDescriptor[] = [
  {
    id: "read-capabilities",
    kind: OperationKinds.QUERY,
    classification: WriteClassifications.READ,
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
