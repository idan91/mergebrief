import type {
  ContextSourcesConfig,
  Effort,
  GenerateRequest,
  Generator,
  GeneratorConfig,
  GeneratorWarning,
  ScreenedAttempt,
} from "generators";
import type { z } from "zod/v4";

/** Shorter values match ordinary prose, so the scan ignores them. */
const MIN_SECRET_LENGTH = 12;

/** Secrets whose names carry no secret word. */
const NAMED_SECRET_VARS = new Set([
  "DATABASE_URL",
  "OTEL_EXPORTER_OTLP_HEADERS",
]);

/** `GH_TOKEN`, `GITHUB_WEBHOOK_SECRET`, an operator's own `LINEAR_API_KEY`. */
const SECRET_NAME_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD)(_V\d+)?$/;

const PEM_FENCE_PREFIX = "-----";

/** One value no generation output may contain, named by its env var. */
export interface OutputSecret {
  readonly envVar: string;
  readonly value: string;
}

/** Where a secret sat: the output field and the env var, never the value. */
export interface OutputSecretHit {
  readonly fieldPath: string;
  readonly envVar: string;
}

/** A generation whose output carried a value the instance treats as secret. */
export class OutputSecretError extends Error {
  readonly hit: OutputSecretHit;

  constructor(hit: OutputSecretHit) {
    super(
      `generation output contained the value of ${hit.envVar} at ${hit.fieldPath}`,
    );
    this.name = "OutputSecretError";
    this.hit = hit;
  }
}

function isSecretVar(name: string): boolean {
  return NAMED_SECRET_VARS.has(name) || SECRET_NAME_PATTERN.test(name);
}

/** A malformed escape keeps its raw form rather than failing worker boot. */
function decodeUrlComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function readUrlPassword(value: string): string | undefined {
  if (!URL.canParse(value)) {
    return undefined;
  }
  const encoded = new URL(value).password;
  const password = decodeUrlComponent(encoded);
  return password === "" ? undefined : password;
}

/** A value as JSON writes it inside a string, which is how salvage and raw output carry it. */
function escapeForJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** The whole value, a URL's password, and each line of a PEM body. */
function splitSecretValue(value: string): string[] {
  const parts = [value];
  const password = readUrlPassword(value);
  if (password !== undefined) {
    parts.push(password);
  }
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== value && !trimmed.startsWith(PEM_FENCE_PREFIX)) {
      parts.push(trimmed);
    }
  }
  return parts.filter((part) => part.length >= MIN_SECRET_LENGTH);
}

/**
 * Every secret value the worker holds, from the env the composition root read.
 * `credentialVars` names the vars the instance config points a credential at,
 * which need not carry a secret word.
 */
export function collectOutputSecrets(
  env: Record<string, string | undefined>,
  credentialVars: readonly string[] = [],
): OutputSecret[] {
  const named = new Set(credentialVars);
  const secrets: OutputSecret[] = [];
  for (const [envVar, value] of Object.entries(env)) {
    const secretVar = named.has(envVar) || isSecretVar(envVar);
    if (value === undefined || !secretVar) {
      continue;
    }
    const parts = splitSecretValue(value);
    for (const part of new Set([...parts, ...parts.map(escapeForJson)])) {
      secrets.push({ envVar, value: part });
    }
  }
  return secrets;
}

function findInString(
  text: string,
  fieldPath: string,
  secrets: readonly OutputSecret[],
): OutputSecretHit | undefined {
  const secret = secrets.find((candidate) => text.includes(candidate.value));
  return secret === undefined
    ? undefined
    : { fieldPath, envVar: secret.envVar };
}

function joinFieldPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function walkOutput(
  value: unknown,
  fieldPath: string,
  secrets: readonly OutputSecret[],
): OutputSecretHit | undefined {
  if (typeof value === "string") {
    return findInString(value, fieldPath, secrets);
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = walkOutput(item, `${fieldPath}[${index}]`, secrets);
      if (hit !== undefined) {
        return hit;
      }
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const hit = walkOutput(child, joinFieldPath(fieldPath, key), secrets);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

/** The first string field of `output` holding a secret value, if any. */
export function findOutputSecret(
  output: unknown,
  secrets: readonly OutputSecret[],
): OutputSecretHit | undefined {
  return walkOutput(output, "", secrets);
}

/** The env vars the instance config names as credentials: the generator's key and each context-source token. */
export function listCredentialVars(
  generator: GeneratorConfig,
  contextSources: ContextSourcesConfig,
): string[] {
  const vars = contextSources.flatMap((source) =>
    source.tokenEnv === undefined ? [] : [source.tokenEnv],
  );
  if ("apiKeyEnv" in generator && generator.apiKeyEnv !== undefined) {
    vars.push(generator.apiKeyEnv);
  }
  return vars;
}

/** Longest first, so a secret holding a shorter one is masked whole. */
function maskSecrets(text: string, secrets: readonly OutputSecret[]): string {
  let masked = text;
  const longestFirst = secrets.toSorted(
    (a, b) => b.value.length - a.value.length,
  );
  for (const secret of longestFirst) {
    masked = masked.replaceAll(secret.value, `[${secret.envVar}]`);
  }
  return masked;
}

/** What the run's side channels saw: the first secret any of them carried. */
interface SideChannelScan {
  hit: OutputSecretHit | undefined;
}

/**
 * The request with every side channel the adapter writes model text to
 * masked, and the first secret it carried recorded: a salvaged attempt can
 * drop the field that held one and still print it in its warning.
 */
function guardRequest<S extends z.ZodType>(
  req: GenerateRequest<S>,
  secrets: readonly OutputSecret[],
  scan: SideChannelScan,
): GenerateRequest<S> {
  const record = (text: string, fieldPath: string): string => {
    scan.hit ??= findInString(text, fieldPath, secrets);
    return maskSecrets(text, secrets);
  };
  const guarded: GenerateRequest<S> = {
    ...req,
    redact: (text) => record(req.redact?.(text) ?? text, "dump"),
    screenAttempt: (attempt: ScreenedAttempt) => {
      req.screenAttempt?.(attempt);
      const hit =
        findOutputSecret(attempt.parsed, secrets) ??
        findInString(attempt.raw, "attempt", secrets);
      if (hit !== undefined) {
        throw new OutputSecretError(hit);
      }
    },
  };
  const { log, onWarning } = req;
  if (log !== undefined) {
    guarded.log = (message) => log(record(message, "log"));
  }
  if (onWarning !== undefined) {
    guarded.onWarning = (warning: GeneratorWarning) =>
      onWarning({ ...warning, message: record(warning.message, "warning") });
  }
  return guarded;
}

/** A failed run whose error carries a secret fails as `output-secret`, so the message never travels. */
function rethrowGuarded(
  error: unknown,
  secrets: readonly OutputSecret[],
  scan: SideChannelScan,
): never {
  const message = error instanceof Error ? error.message : "";
  const hit = scan.hit ?? findInString(message, "error", secrets);
  if (hit !== undefined) {
    throw new OutputSecretError(hit);
  }
  throw error;
}

/**
 * Every generation the worker runs passes through here, so a Brief, a Delta
 * Brief and a Revision narrative steered into printing a secret never reach
 * storage or a Reviewer's browser, through the output, a warning, a log line,
 * an error or a failure dump.
 */
export function guardGeneratorOutput(
  generator: Generator,
  secrets: readonly OutputSecret[],
): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const scan: SideChannelScan = { hit: undefined };
      let output: z.infer<S>;
      try {
        output = await generator.generate(guardRequest(req, secrets, scan));
      } catch (error) {
        if (req.signal?.aborted === true) {
          throw error;
        }
        return rethrowGuarded(error, secrets, scan);
      }

      const hit = scan.hit ?? findOutputSecret(output, secrets);
      if (hit !== undefined) {
        throw new OutputSecretError(hit);
      }
      return output;
    },
    origin: (effort: Effort) => generator.origin(effort),
  };
}
