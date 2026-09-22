import { isInstallationId, isRepoId, type RepoId } from "persistence";
import { describe, expect, it } from "vitest";
import type { AllowedRepo } from "../../installation-resolver";
import type { PrView } from "../../pr-view";
import {
  groupAllowedByInstallation,
  mergePullPages,
} from "./merge-installations";

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) throw new Error("unbrandable fixture value");
  return value;
}

const ACME = brand(10n, isInstallationId);
const OCTO = brand(20n, isInstallationId);

function stubView(prNumber: number, updatedAt: string): PrView {
  return { prNumber, updatedAt } as unknown as PrView;
}

describe("groupAllowedByInstallation", () => {
  it("splits the allowed set by the installation holding each repo", () => {
    const allowed = new Map<RepoId, AllowedRepo>([
      [brand(1n, isRepoId), { installationId: ACME, fullName: "acme/a" }],
      [brand(2n, isRepoId), { installationId: OCTO, fullName: "octo/b" }],
      [brand(3n, isRepoId), { installationId: ACME, fullName: "acme/c" }],
    ]);

    const groups = groupAllowedByInstallation(allowed);

    expect([...groups.keys()]).toEqual([ACME, OCTO]);
    expect([...(groups.get(ACME)?.keys() ?? [])]).toEqual([1n, 3n]);
    expect([...(groups.get(OCTO)?.keys() ?? [])]).toEqual([2n]);
  });
});

describe("mergePullPages", () => {
  it("interleaves pages newest first under the cap", () => {
    const merged = mergePullPages(
      [
        [
          stubView(1, "2026-09-01T00:00:00.000Z"),
          stubView(2, "2026-08-01T00:00:00.000Z"),
        ],
        [stubView(3, "2026-09-15T00:00:00.000Z")],
      ],
      2,
    );

    expect(merged.map((view) => view.prNumber)).toEqual([3, 1]);
  });
});
