// Stage 4 audit-emit tests (PGlite). Prove the D9 append-only emit inserts with
// dangling (non-FK) targets and validates metadata.
import { describe, expect, it } from "vitest";
import { audit, AuditMetadataSchema, AuditTargetTypeSchema, type AuditEntry } from "../src/index";
import { AuditAction, AuditActorType, isInstallationId, type InstallationId } from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);

describe("audit — append-only emit (D9)", () => {
  it("inserts a generate emit with a dangling numeric target (no FK)", async () => {
    const handle = await freshDatabase();
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorType.APP,
      action: AuditAction.GENERATE,
      targetType: "brief",
      targetId: 424242n, // no such brief row — audit has NO outbound FK
      metadata: { kind: "brief" },
    };

    const row = await audit(handle, entry);
    expect(row.installationId).toBe(TENANT);
    expect(row.action).toBe(AuditAction.GENERATE);
    expect(row.targetId).toBe(424242n);
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it("records an auth denial as action=auth with a decision in metadata", async () => {
    const handle = await freshDatabase();
    const row = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      action: AuditAction.AUTH,
      metadata: { decision: "403" },
    });
    expect(row.action).toBe(AuditAction.AUTH);
    expect(row.metadata).toEqual({ decision: "403" });
    expect(row.targetType).toBeNull();
  });

  it("records a review submit as action=submit against the CHECK vocabulary (BRIEF-23)", async () => {
    const handle = await freshDatabase();
    const row = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      action: AuditAction.SUBMIT,
      targetType: "pull_request",
      targetId: 7n,
    });
    expect(row.action).toBe(AuditAction.SUBMIT);
    expect(row.action).toBe("submit");
  });

  it("records thread resolution flips against the CHECK vocabulary (BRIEF-93)", async () => {
    // Both directions must clear the DB CHECK constraint (migration 0014, in
    // lockstep with `AuditAction` — the 0007/0010 pattern).
    const handle = await freshDatabase();
    const resolved = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      action: AuditAction.RESOLVE_THREAD,
      targetType: "review_comment",
      targetId: 12345n,
    });
    expect(resolved.action).toBe("resolve-thread");
    const unresolved = await audit(handle, {
      installationId: TENANT,
      actorType: AuditActorType.REVIEWER,
      actorId: 31337n,
      action: AuditAction.UNRESOLVE_THREAD,
      targetType: "review_comment",
      targetId: 12345n,
    });
    expect(unresolved.action).toBe("unresolve-thread");
  });

  it("metadata keys are a closed allowlist — unknown key rejected", () => {
    // `audit()` runs this same schema with `.parse()`, so these throw there.
    expect(AuditMetadataSchema.safeParse({ email: "x" }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ ip: "1.2.3.4" }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ decision: "403" }).success).toBe(true);
    expect(AuditMetadataSchema.safeParse({ decision: "403", count: 2 }).success).toBe(true);
  });

  it("rejects values that could carry PII into the un-erasable ledger", () => {
    // "@" guard — no legitimate value in a numeric-id ledger contains an email.
    expect(AuditMetadataSchema.safeParse({ "reason-code": "user@example.com" }).success).toBe(false);
    // Over-long values rejected (max 64).
    expect(AuditMetadataSchema.safeParse({ kind: "x".repeat(65) }).success).toBe(false);
    // Non-printable-ASCII rejected (control chars, non-ASCII).
    expect(AuditMetadataSchema.safeParse({ kind: "a\nb" }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ kind: "na\u00efve" }).success).toBe(false);
    // Nested objects still rejected.
    expect(AuditMetadataSchema.safeParse({ decision: { nested: true } }).success).toBe(false);
  });

  it("rejects non-finite numbers (JSON would silently null them in jsonb)", () => {
    expect(AuditMetadataSchema.safeParse({ count: Infinity }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ count: -Infinity }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ count: Number.NaN }).success).toBe(false);
    expect(AuditMetadataSchema.safeParse({ count: 42 }).success).toBe(true);
  });

  it("targetType must be a class token, never identifying text", async () => {
    expect(AuditTargetTypeSchema.safeParse("pull_request").success).toBe(true);
    expect(AuditTargetTypeSchema.safeParse("revision_narrative2").success).toBe(true);
    expect(AuditTargetTypeSchema.safeParse("acme/widgets").success).toBe(false);
    expect(AuditTargetTypeSchema.safeParse("user@example.com").success).toBe(false);
    expect(AuditTargetTypeSchema.safeParse("PullRequest").success).toBe(false);
    expect(AuditTargetTypeSchema.safeParse("a".repeat(65)).success).toBe(false);

    // audit() enforces it (throws — programmer error, same as metadata).
    const handle = await freshDatabase();
    const entry: AuditEntry = {
      installationId: TENANT,
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.DELETE,
      targetType: "repos/acme/widgets",
      targetId: 1n,
    };
    await expect(audit(handle, entry)).rejects.toThrow(/class token/);
  });
});
