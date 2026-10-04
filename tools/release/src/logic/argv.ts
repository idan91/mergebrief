import type { Result } from "types/utils";

export interface ArgvSpec {
  /** Flags that take the next argument as their value, `""` included. */
  readonly valued: readonly string[];
  readonly boolean: readonly string[];
  readonly maxPositionals: number;
}

export interface ParsedArgv {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

/** Strict: every token is a known flag, its value, or an allowed positional. */
export function parseArgv(
  argv: readonly string[],
  spec: ArgvSpec,
): Result<ParsedArgv, string> {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }
    const isFlag = token.startsWith("--");
    if (!isFlag) {
      positionals.push(token);
      continue;
    }
    if (flags.has(token)) {
      return { ok: false, error: `${token} given twice` };
    }
    if (spec.boolean.includes(token)) {
      flags.set(token, true);
      continue;
    }
    if (!spec.valued.includes(token)) {
      const looksAssigned = token.includes("=");
      const hint = looksAssigned ? "; pass the value as the next argument" : "";
      return { ok: false, error: `unknown flag ${token}${hint}` };
    }

    const value = argv[index + 1];
    const valueMissing = value === undefined || value.startsWith("--");
    if (valueMissing) {
      return { ok: false, error: `${token} needs a value` };
    }
    flags.set(token, value);
    index += 1;
  }

  const tooManyPositionals = positionals.length > spec.maxPositionals;
  if (tooManyPositionals) {
    return {
      ok: false,
      error: `unexpected argument ${positionals[spec.maxPositionals]}`,
    };
  }
  return { ok: true, value: { positionals, flags } };
}

/** The value of a valued flag; absent flags read as `undefined`. */
export function readValuedFlag(
  parsed: ParsedArgv,
  flag: string,
): string | undefined {
  const value = parsed.flags.get(flag);
  return typeof value === "string" ? value : undefined;
}
