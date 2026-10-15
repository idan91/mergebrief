// The `capabilities` command, the third CLI-synthesized shape: the server's
// registered operations joined with what only this binary knows (its command
// map and version). `--require` is a fail-closed compatibility check
// (exit 6), never negotiation.
import { ProductQueryIds, type CatalogOperation } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { CliError, ExitCodes } from "../../exit";
import { labelArm, parseOperationsMap, type CliArm } from "./map";
import type { CommandIo } from "../../types";
import { buildRequestPath } from "../request-path";

/**
 * The one field of each `read-capabilities` operation the join reads. The key
 * comes from the contract; the value is any string, so a newer server's
 * operation id still parses.
 */
type CapabilitySlice = Readonly<
  Record<keyof Pick<CatalogOperation, "id">, string>
>;

interface CapabilitiesSlice {
  readonly operations: readonly CapabilitySlice[];
}

// Tolerant-read slice: only the join key is required; every other server
// field passes through untouched (additive-only tolerance).
const responseSliceSchema = z.object({
  operations: z.array(z.object({ id: z.string() }).loose()),
}) satisfies z.ZodType<CapabilitiesSlice>;

export interface CapabilitiesRunDeps {
  readonly client: ApiClient;
  readonly cliVersion: string;
  /** The imported committed map, validated here, at the runtime boundary. */
  readonly operationsMapRaw: unknown;
  readonly requireIds: readonly string[];
  readonly io: CommandIo;
}

export async function runCapabilities(
  deps: CapabilitiesRunDeps,
): Promise<void> {
  const entries = parseOperationsMap(deps.operationsMapRaw);

  const response = await deps.client.request({
    path: buildRequestPath(ProductQueryIds.READ_CAPABILITIES, {}),
  });
  const raw: unknown = JSON.parse(response.bodyText);
  const parsed = responseSliceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError(
      ExitCodes.GENERIC,
      "the server's capabilities response did not match the documented shape (version skew? check `mergebrief auth status`)",
    );
  }
  const { operations } = parsed.data;
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

  const joined = operations.map((op) => {
    const cli: CliArm = entries.get(op.id) ?? { unknownToCli: true };
    return { ...op, cli };
  });
  const body = {
    cliVersion: deps.cliVersion,
    operations: joined,
  };

  if (deps.io.json) {
    deps.io.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering, explicitly NON-contractual.
  for (const op of joined) {
    deps.io.stdout(`${op.id}\t${labelArm(op.cli)}\n`);
  }
}
