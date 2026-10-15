import { CliError, ExitCodes } from "../exit";
import type { CliDeps } from "../types";

/** Read `-F`/`--body-file` sources: a path, or "-" for stdin. */
export async function readSource(
  deps: CliDeps,
  source: string,
): Promise<string> {
  if (source === "-") {
    return deps.readStdin();
  }
  const readFile = deps.readFile;
  if (readFile === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "file input is not available in this environment",
    );
  }
  try {
    return readFile(source);
  } catch {
    throw new CliError(ExitCodes.USAGE, `could not read ${source}`);
  }
}

export function parsePayloadSource(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(ExitCodes.USAGE, "the -F payload is not valid JSON");
  }
}

/** A `-F` payload: read from its source, then parsed as JSON. */
export async function readPayload(
  deps: CliDeps,
  source: string,
): Promise<unknown> {
  const raw = await readSource(deps, source);
  return parsePayloadSource(raw);
}

/** `--body` beats `--body-file`; one of them is required. */
export async function readBodySource(
  deps: CliDeps,
  body: string | undefined,
  bodyFile: string | undefined,
): Promise<string> {
  if (body !== undefined && bodyFile !== undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "--body and --body-file are mutually exclusive",
    );
  }
  if (body !== undefined) {
    return body;
  }
  if (bodyFile !== undefined) {
    return (await readSource(deps, bodyFile)).replace(/\n$/, "");
  }
  throw new CliError(ExitCodes.USAGE, "a reply needs --body or --body-file");
}
