// Audit-emit tests (PGlite): the append-only emit inserts with dangling
// (non-FK) targets and validates metadata.
import { describe, expect, it } from "vitest";
import {
  audit,
  AuditMetadataSchema,
  AuditTargetTypeSchema,
  sweepAuditLog,
  type AuditEntry,
} from "../src/index";
import { internal } from "../src/db/handle";
import { auditLog } from "../src/schema/audit-log";
import {
  AuditChannel,
  WriteClassification,
  AuditOutcome,
  AuditActorType,
  isInstallationId,
  type InstallationId,
} from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);

describe("audit — append-only emit", () => {
  it("inserts a generate emit with a dangling numeric target (no FK)", async () => {
    const handle = await freshDatabase();
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorType.APP,
      operation: "generate",
      outcome: AuditOutcome.OK,
      targetType: "brief",
      targetId: 424242n, // no such brief row — audit has NO outbound FK
      metadata: { kind: "brief" },
    };

    const row = await audit(handle, entry);
    expect(row.installationId).toBe(TENANT);
    expect(row.operation).toBe("generate");
    expect(row.targetId).toBe(424242n);
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it("records an auth denial as action=auth with a decision in metadata", async () => {
    const handle = await freshDatabase();
    const row = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      operation: "auth",
      outcome: AuditOutcome.OK,
      metadata: { decision: "403" },
    });
    expect(row.operation).toBe("auth");
    expect(row.metadata).toEqual({ decision: "403" });
    expect(row.targetType).toBeNull();
  });

  it("records a review submit as action=submit against the CHECK vocabulary", async () => {
    const handle = await freshDatabase();
    const row = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      operation: "submit",
      outcome: AuditOutcome.OK,
      targetType: "pull_request",
      targetId: 7n,
    });
    expect(row.operation).toBe("submit");
    expect(row.operation).toBe("submit");
  });

  it("records both thread resolution directions as their own operation", async () => {
    const handle = await freshDatabase();
    const resolved = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      operation: "resolve-thread",
      outcome: AuditOutcome.OK,
      targetType: "review_comment",
      targetId: 12345n,
    });
    expect(resolved.operation).toBe("resolve-thread");
    const unresolved = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      operation: "unresolve-thread",
      outcome: AuditOutcome.OK,
      targetType: "review_comment",
      targetId: 12345n,
    });
    expect(unresolved.operation).toBe("unresolve-thread");
  });

  it("metadata keys are open — any snake_case token is accepted", () => {
    // `audit()` runs this same schema with `.parse()`, so these throw there.
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

  it("metadata values are closed — token, finite number, or boolean only", () => {
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

  it("rejects non-finite numbers (JSON would silently null them in jsonb)", () => {
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

    // audit() enforces it (throws — programmer error, same as metadata).
    const handle = await freshDatabase();
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorType.SYSTEM,
      operation: "delete",
      outcome: AuditOutcome.OK,
      targetType: "repos/acme/widgets",
      targetId: 1n,
    };
    await expect(audit(handle, entry)).rejects.toThrow(/class token/);
  });
});

const OTHER_TENANT: InstallationId = brandWith(isInstallationId, 2000n);
const NOW = new Date("2026-03-01T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Seed a row with an explicit `occurred_at` (the column defaults to now()). */
async function seedAged(
  handle: Awaited<ReturnType<typeof freshDatabase>>,
  installationId: InstallationId,
  occurredAt: Date,
): Promise<void> {
  await internal(handle).insert(auditLog).values({
    installationId,
    actorType: AuditActorType.SYSTEM,
    operation: "generate",
    outcome: AuditOutcome.OK,
    occurredAt,
  });
}

describe("audit — the forensic call-shape fields", () => {
  it("rejects a request id, client or caller IP that is not its own shape", async () => {
    const handle = await freshDatabase();
    const base: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      operation: "mark-ready",
      outcome: AuditOutcome.OK,
    };
    await expect(
      audit(handle, { ...base, requestId: "req 1/2" }),
    ).rejects.toThrow(/correlation token/);
    await expect(
      audit(handle, { ...base, client: "idan reviewing acme/widgets" }),
    ).rejects.toThrow(/product\/version token/);
    await expect(
      audit(handle, { ...base, client: "user@example.com" }),
    ).rejects.toThrow(/product\/version token/);
    await expect(
      audit(handle, { ...base, callerIp: "user@example.com" }),
    ).rejects.toThrow(/IP address/);

    // Anything the Zod shapes accept must clear the DB CHECKs too: a mismatch
    // would throw inside the caller's transaction, rolling back the action the
    // row was meant to record.
    const widest = await audit(handle, {
      ...base,
      requestId: "r".repeat(64),
      client: "mergebrief-cli/10.20.30-rc.1",
      callerIp: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    });
    expect(widest.requestId).toHaveLength(64);

    const row = await audit(handle, {
      ...base,
      requestId: "01JABCDEF",
      client: "mergebrief/0.1.0",
      callerIp: "203.0.113.7",
      channel: AuditChannel.BEARER,
      classification: WriteClassification.EXTERNAL_WRITE,
      credentialId: 42n,
    });
    expect(row.client).toBe("mergebrief/0.1.0");
    expect(row.callerIp).toBe("203.0.113.7");
    expect(row.credentialId).toBe(42n);
  });
});

describe("sweepAuditLog — instance-wide retention", () => {
  it("keeps everything when retention is unset", async () => {
    const handle = await freshDatabase();
    await seedAged(handle, TENANT, daysAgo(4000));

    expect(await sweepAuditLog(handle, null, NOW)).toBe(0);
    expect(await internal(handle).select().from(auditLog)).toHaveLength(1);
  });

  it("erases rows past the window across every installation and records the count", async () => {
    const handle = await freshDatabase();
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
    const handle = await freshDatabase();
    await seedAged(handle, TENANT, daysAgo(5));

    expect(await sweepAuditLog(handle, 30, NOW)).toBe(0);
    expect(await internal(handle).select().from(auditLog)).toHaveLength(1);
  });

  it("refuses a window the config layer would never have accepted", async () => {
    const handle = await freshDatabase();
    await expect(sweepAuditLog(handle, 7, NOW)).rejects.toThrow(/30/);
    await expect(sweepAuditLog(handle, 30.5, NOW)).rejects.toThrow(/whole/);
  });
});
