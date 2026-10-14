import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OPEN_POLICY } from "../../test/fixtures";
import { computeCatalogFingerprint } from "./catalog";

describe("computeCatalogFingerprint", () => {
  const probe = {
    id: "list-inbox",
    kind: "query",
    classification: "read",
    ...OPEN_POLICY,
    endpoint: "GET /api/inbox",
  } as const;
  const other = {
    id: "list-repos",
    kind: "query",
    classification: "read",
    ...OPEN_POLICY,
    endpoint: "GET /api/repos",
  } as const;

  it("is the sha256 hex of the rendered catalog bytes", () => {
    const rendered = `${JSON.stringify(
      {
        operations: [
          {
            id: probe.id,
            kind: probe.kind,
            classification: probe.classification,
            endpoint: probe.endpoint,
          },
        ],
      },
      null,
      2,
    )}\n`;

    expect(computeCatalogFingerprint([probe])).toBe(
      createHash("sha256").update(rendered).digest("hex"),
    );
  });

  it("is insensitive to the order descriptors arrive in", () => {
    expect(computeCatalogFingerprint([probe, other])).toBe(
      computeCatalogFingerprint([other, probe]),
    );
  });

  it("changes when any descriptor field changes", () => {
    const moved = { ...probe, endpoint: "GET /api/auth/tokens" } as const;

    expect(computeCatalogFingerprint([moved])).not.toBe(
      computeCatalogFingerprint([probe]),
    );
  });
});
