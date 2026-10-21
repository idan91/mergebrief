// Audit-emit tests (PGlite): the append-only emit inserts with dangling
// (non-FK) targets and validates metadata.
import { describe, expect, it } from "vitest";
import {
  writeAudit,
  AuditMetadataSchema,
  AuditTargetTypeSchema,
  sweepAuditLog,
  type AppDatabase,
  type AuditEntry,
} from "../src/index";
import { internal } from "../src/db/handle";
import { auditLog } from "../src/schema/audit-log";
import {
  AuditChannels,
  AuditOutcomes,
  AuditActorTypes,
  isInstallationId,
  type InstallationId,
} from "../src/types";
import { brandWith, registerSharedPglite } from "./helpers";
import { AccessLevels } from "types/access-levels";

const shared = registerSharedPglite();

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);

describe("writeAudit append-only emit", () => {
  it("inserts a generate emit with a dangling numeric target and no FK", async () => {
    const handle = shared.handle;
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorTypes.APP,
      operation: "generate",
      outcome: AuditOutcomes.OK,
      targetType: "brief",
      targetId: 424242n, // no such brief row: audit has NO outbound FK
      metadata: { kind: "brief" },
    };

    const row = await writeAudit(handle, entry);
    expect(row.installationId).toBe(TENANT);
    expect(row.operation).toBe("generate");
    expect(row.targetId).toBe(424242n);
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it("metadata keys are open: any snake_case token is accepted", () => {
    // `writeAudit()` runs this same schema with `.parse()`, so these throw there.
    expect(
      AuditMetadataSchema.safeParse({ carry_status: "settled" }).success,
    ).toBe(true);
    expect(AuditMetadataSchema.safeParse({ decision: "403" }).success).toBe(
      true,
    );
    expect(
      AuditMetadataSchema.safeParse({ decision: "403", count: 2 }).success,
    ).toBe(true);
    // Not a token: uppercase, punctuation, or a route-shaped key.
    expect(AuditMetadataSchema.safeParse({ Decision: "403" }).success).toBe(
      false,
    );
    expect(AuditMetadataSchema.safeParse({ "repos/acme": "x" }).success).toBe(
      false,
    );
  });

  it("metadata values are closed: token, finite number, or boolean only", () => {
    expect(AuditMetadataSchema.safeParse({ kind: "mark-ready" }).success).toBe(
      true,
    );
    expect(AuditMetadataSchema.safeParse({ carried: true }).success).toBe(true);
    // A string that is not an enum token: free text, an email, an address.
    expect(
      AuditMetadataSchema.safeParse({ kind: "resolved the thread" }).success,
    ).toBe(false);
    expect(
      AuditMetadataSchema.safeParse({ actor: "user@example.com" }).success,
    ).toBe(false);
    expect(AuditMetadataSchema.safeParse({ ip: "10.0.0.1" }).success).toBe(
      false,
    );
    // Over-long values rejected (max 64).
    expect(
      AuditMetadataSchema.safeParse({ kind: "x".repeat(65) }).success,
    ).toBe(false);
    // Objects, arrays and null are not values at all.
    expect(
      AuditMetadataSchema.safeParse({ decision: { nested: true } }).success,
    ).toBe(false);
    expect(AuditMetadataSchema.safeParse({ decision: ["403"] }).success).toBe(
      false,
    );
    expect(AuditMetadataSchema.safeParse({ decision: null }).success).toBe(
      false,
    );
  });

  it("rejects non-finite numbers that jsonb would silently null", () => {
    expect(AuditMetadataSchema.safeParse({ count: Infinity }).success).toBe(
      false,
    );
    expect(AuditMetadataSchema.safeParse({ count: -Infinity }).success).toBe(
      false,
    );
    expect(AuditMetadataSchema.safeParse({ count: Number.NaN }).success).toBe(
      false,
    );
    expect(AuditMetadataSchema.safeParse({ count: 42 }).success).toBe(true);
  });

  it("targetType must be a class token, never identifying text", async () => {
    expect(AuditTargetTypeSchema.safeParse("pull_request").success).toBe(true);
    expect(AuditTargetTypeSchema.safeParse("revision_narrative2").success).toBe(
      true,
    );
    expect(AuditTargetTypeSchema.safeParse("acme/widgets").success).toBe(false);
    expect(AuditTargetTypeSchema.safeParse("user@example.com").success).toBe(
      false,
    );
    expect(AuditTargetTypeSchema.safeParse("PullRequest").success).toBe(false);
    expect(AuditTargetTypeSchema.safeParse("a".repeat(65)).success).toBe(false);

    // writeAudit() enforces it (throws, a programmer error, same as metadata).
    const handle = shared.handle;
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorTypes.SYSTEM,
      operation: "delete",
      outcome: AuditOutcomes.OK,
      targetType: "repos/acme/widgets",
      targetId: 1n,
    };
    await expect(writeAudit(handle, entry)).rejects.toThrow(/class token/);
  });
});

const OTHER_TENANT: InstallationId = brandWith(isInstallationId, 2000n);
const NOW = new Date("2026-03-01T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Seed a row with an explicit `occurred_at` (the column defaults to now()). */
async function seedAged(
  handle: AppDatabase,
  installationId: InstallationId,
  occurredAt: Date,
): Promise<void> {
  await internal(handle).insert(auditLog).values({
    installationId,
    actorType: AuditActorTypes.SYSTEM,
    operation: "generate",
    outcome: AuditOutcomes.OK,
    occurredAt,
  });
}

describe("writeAudit forensic call-shape fields", () => {
  it("rejects a request id or client that is not its own shape", async () => {
    const handle = shared.handle;
    const base: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorTypes.REVIEWER,
      operation: "mark-ready",
      outcome: AuditOutcomes.OK,
    };
    await expect(
      writeAudit(handle, { ...base, requestId: "req 1/2" }),
    ).rejects.toThrow(/correlation token/);
    await expect(
      writeAudit(handle, { ...base, client: "idan reviewing acme/widgets" }),
    ).rejects.toThrow(/product\/version token/);
    await expect(
      writeAudit(handle, { ...base, client: "user@example.com" }),
    ).rejects.toThrow(/product\/version token/);

    // Anything the Zod shapes accept must clear the DB CHECKs too: a mismatch
    // would throw inside the caller's transaction, rolling back the action the
    // row was meant to record.
    const widest = await writeAudit(handle, {
      ...base,
      requestId: "r".repeat(64),
      client: "mergebrief-cli/10.20.30-rc.1",
    });
    expect(widest.requestId).toHaveLength(64);

    const row = await writeAudit(handle, {
      ...base,
      requestId: "01JABCDEF",
      client: "mergebrief/0.1.0",
      channel: AuditChannels.BEARER,
      classification: AccessLevels.EXTERNAL_WRITE,
      credentialId: 42n,
    });
    expect(row.client).toBe("mergebrief/0.1.0");
    expect(row.credentialId).toBe(42n);
  });
});

describe("sweepAuditLog instance-wide retention", () => {
  it("keeps everything when retention is unset", async () => {
    const handle = shared.handle;
    await seedAged(handle, TENANT, daysAgo(4000));

    expect(await sweepAuditLog(handle, null, NOW)).toBe(0);
    expect(await internal(handle).select().from(auditLog)).toHaveLength(1);
  });

  it("erases rows past the window in every installation and counts them", async () => {
    const handle = shared.handle;
    await seedAged(handle, TENANT, daysAgo(120));
    await seedAged(handle, TENANT, daysAgo(90));
    await seedAged(handle, TENANT, daysAgo(10));
    await seedAged(handle, OTHER_TENANT, daysAgo(200));

    expect(await sweepAuditLog(handle, 30, NOW)).toBe(3);

    const remaining = await internal(handle).select().from(auditLog);
    // The kept row, plus one `delete` entry per installation swept.
    expect(remaining).toHaveLength(3);
    const sweeps = remaining.filter((row) => row.operation === "delete");
    expect(sweeps).toHaveLength(2);
    const sweptCounts = new Map(
      sweeps.map((row) => [String(row.installationId), row.metadata]),
    );
    expect(sweptCounts.get(String(TENANT))).toEqual({ count: 2 });
    expect(sweptCounts.get(String(OTHER_TENANT))).toEqual({ count: 1 });
    expect(sweeps.every((row) => row.targetType === "audit_log")).toBe(true);
  });

  it("emits nothing when the sweep erased nothing", async () => {
    const handle = shared.handle;
    await seedAged(handle, TENANT, daysAgo(5));

    expect(await sweepAuditLog(handle, 30, NOW)).toBe(0);
    expect(await internal(handle).select().from(auditLog)).toHaveLength(1);
  });

  it("refuses a window the config layer would never have accepted", async () => {
    const handle = shared.handle;
    await expect(sweepAuditLog(handle, 7, NOW)).rejects.toThrow(/30/);
    await expect(sweepAuditLog(handle, 30.5, NOW)).rejects.toThrow(/whole/);
  });
});
