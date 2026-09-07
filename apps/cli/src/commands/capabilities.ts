// The `capabilities` command — the third CLI-synthesized shape: the server's
// registered operations joined with what only this binary knows (its command
// map, version, baked fingerprint). `--require` is a fail-closed
// compatibility check (exit 6), never negotiation; a fingerprint mismatch
// alone is one stderr warning, never a gate.
import { z } from "zod";
import type { ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import { labelArm, parseOperationsMap, type CliArm } from "./capabilities-map";
import type { ReadIo } from "./read";

// Tolerant-read slice: only the join key is required; every other server
// field passes through untouched (additive-only tolerance).
const responseSliceSchema = z.object({
  operations: z.array(z.object({ id: z.string() }).passthrough()),
  catalogFingerprint: z.string(),
});

export interface CapabilitiesRunDeps {
  readonly client: ApiClient;
  readonly cliVersion: string;
  readonly cliCatalogFingerprint: string;
  /** The imported committed map — validated here, at the runtime boundary. */
  readonly operationsMapRaw: unknown;
  readonly requireIds: readonly string[];
  readonly io: ReadIo;
}

export async function runCapabilities(
  deps: CapabilitiesRunDeps,
): Promise<void> {
  const entries = parseOperationsMap(deps.operationsMapRaw);

  const response = await deps.client.request({ path: "/api/capabilities" });
  const raw: unknown = JSON.parse(response.bodyText);
  const parsed = responseSliceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError(
      ExitCodes.GENERIC,
      "the server's capabilities response did not match the documented shape (version skew? check `mergebrief auth status`)",
    );
  }
  const { operations, catalogFingerprint } = parsed.data;
  const serverIds = new Set(operations.map((op) => op.id));

  const failures: string[] = [];
  for (const id of new Set(deps.requireIds)) {
    if (!serverIds.has(id)) {
      failures.push(`${id} (not registered on this server)`);
      continue;
    }
    const entry = entries.get(id);
    if (entry === undefined || !("command" in entry)) {
      failures.push(`${id} (no CLI command in this binary)`);
    }
  }
  if (failures.length > 0) {
    throw new CliError(
      ExitCodes.INCOMPATIBLE,
      `incompatible: ${failures.join("; ")}`,
    );
  }

  const fingerprintMatch = catalogFingerprint === deps.cliCatalogFingerprint;
  if (!fingerprintMatch) {
    deps.io.stderr(
      "warning: the server's catalog fingerprint differs from this CLI's baked catalog — additive skew is fine; check `mergebrief auth status` for versions",
    );
  }

  const joined = operations.map((op) => {
    const cli: CliArm = entries.get(op.id) ?? { unknownToCli: true };
    return { ...op, cli };
  });
  const body = {
    cliVersion: deps.cliVersion,
    serverCatalogFingerprint: catalogFingerprint,
    cliCatalogFingerprint: deps.cliCatalogFingerprint,
    fingerprintMatch,
    operations: joined,
  };

  if (deps.io.json) {
    deps.io.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering — explicitly NON-contractual.
  deps.io.stdout(
    `catalog fingerprint: ${fingerprintMatch ? "match" : "MISMATCH"}\n`,
  );
  for (const op of joined) {
    deps.io.stdout(`${op.id}\t${labelArm(op.cli)}\n`);
  }
}
