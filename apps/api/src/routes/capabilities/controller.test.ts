import { describe, expect, it } from "vitest";
import { AccessLevels } from "types/access-levels";
import { OperationKinds } from "contract";
import type { ProductOperationDescriptor } from "../../product-operations/types";
import { capabilitiesController } from "./controller";

const OPERATIONS: readonly ProductOperationDescriptor[] = [
  {
    id: "read-capabilities",
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    endpoint: "GET /api/capabilities",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
];

describe("capabilitiesController.buildCapabilities", () => {
  it("returns the catalog fields, never the policy", () => {
    const body = capabilitiesController.buildCapabilities(OPERATIONS);
    expect(body.operations).toEqual([
      {
        id: "read-capabilities",
        kind: "query",
        classification: "read",
        endpoint: "GET /api/capabilities",
      },
    ]);
    expect(body).not.toHaveProperty("catalogFingerprint");
  });
});
