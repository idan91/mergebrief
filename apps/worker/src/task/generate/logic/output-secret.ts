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
const NAMED_SECRET_VARS = new Set(["DATABASE_URL"]);

/** `OTEL_EXPORTER_OTLP_HEADERS` and its per-signal forms, `..._TRACES_HEADERS` among them. */
const OTLP_HEADERS_VAR = /^OTEL_EXPORTER_OTLP_(?:[A-Z]+_)?HEADERS$/;

/** `GH_TOKEN`, `GITHUB_WEBHOOK_SECRET`, an operator's own `LINEAR_API_KEY`. */
const SECRET_NAME_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD)(_V\d+)?$/;

/** A header named for a credential keeps its value, whatever the value looks like. */
const CREDENTIAL_HEADER_NAME = /auth|key|secret|token|password|credential/i;

/** `application/json`, `checkout-service`: words and separators, which brief text repeats by chance. */
const PLAIN_LABEL_VALUE = /^[a-z]+(?:[-_/.][a-z]+)*$/i;

const PEM_FENCE_PREFIX = "-----";

const BASIC_AUTH_SCHEME = "basic";

const BITS_PER_BYTE = 8;
const BITS_PER_BASE64_CHAR = 6;

/** Base64 packs three bytes into four chars, so a value in a longer payload lands on one of three alignments. */
const BASE64_ALIGNMENTS = [0, 1, 2];

/** Below this many distinct chars a value only counts as written, or a table of zeros would hit. */
const MIN_DISTINCT_CHARS = 6;

/** Letters alone read as words once the spaces go: "a super secret key" is not `supersecretkey`. */
const LETTERS_ONLY = /^[A-Za-z]+$/;

const WHITESPACE = /\s+/g;

/** Whitespace, and the line breaks JSON escapes in a raw attempt. */
const SPACING = /\s+|\\[nrt]/g;

/** The space an auth scheme sits before, as an unparsed header value writes it. */
const HEADER_VALUE_SPACE = /(?:%20|%09|\s)+/;

/** One value no generation output may contain, named by its env var. */
export interface OutputSecret {
  readonly envVar: string;
  readonly value: string;
  /** Text matches only with its spacing as written. */
  readonly exactMatchOnly?: boolean;
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
  const isSecret =
    NAMED_SECRET_VARS.has(name) ||
    OTLP_HEADERS_VAR.test(name) ||
    SECRET_NAME_PATTERN.test(name);
  return isSecret;
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

/** A header value and the credential past its auth scheme, each as written and decoded, and a Basic credential's password. */
function splitHeaderValue(encoded: string): string[] {
  const rawValue = encoded.trim();
  const value = decodeUrlComponent(rawValue);
  const [scheme, credential] = value.split(WHITESPACE);
  if (credential === undefined) {
    return [rawValue, value];
  }
  const [, rawCredential = credential] = rawValue.split(HEADER_VALUE_SPACE);
  const parts = [rawValue, value, rawCredential, credential];
  if (scheme?.toLowerCase() !== BASIC_AUTH_SCHEME) {
    return parts;
  }
  const decoded = Buffer.from(credential, "base64").toString();
  return [...parts, decoded, decoded.slice(decoded.indexOf(":") + 1)];
}

/** The values of a `key=value,key=value` list, never its header names or a plain label under a name that holds no credential. */
function splitOtlpHeaders(value: string): string[] {
  return value.split(",").flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 0) {
      return [];
    }
    const name = entry.slice(0, separator);
    const headerValue = entry.slice(separator + 1);
    const decodedValue = decodeUrlComponent(headerValue.trim());
    const isPlainLabel =
      !CREDENTIAL_HEADER_NAME.test(name) &&
      PLAIN_LABEL_VALUE.test(decodedValue);
    return isPlainLabel ? [] : splitHeaderValue(headerValue);
  });
}

/** The whole value, a URL's password, each line of a PEM body, and each piece of an OTLP header. */
function splitSecretValue(envVar: string, value: string): string[] {
  const parts = [value];
  if (OTLP_HEADERS_VAR.test(envVar)) {
    parts.push(...splitOtlpHeaders(value));
  }
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

/** The base64 chars `value` alone decides when it sits `offset` bytes into a payload. */
function encodeBase64Run(
  value: string,
  offset: number,
  encoding: "base64" | "base64url",
): string {
  const payload = Buffer.concat([Buffer.alloc(offset), Buffer.from(value)]);
  const start = Math.ceil((offset * BITS_PER_BYTE) / BITS_PER_BASE64_CHAR);
  const end = Math.floor(
    (payload.length * BITS_PER_BYTE) / BITS_PER_BASE64_CHAR,
  );
  return payload.toString(encoding).slice(start, end);
}

/** A value's hex forms and its base64 runs, standard and URL-safe, at every alignment. */
function buildEncodedForms(envVar: string, value: string): OutputSecret[] {
  const hex = Buffer.from(value).toString("hex");
  const base64Runs = BASE64_ALIGNMENTS.flatMap((offset) => [
    encodeBase64Run(value, offset, "base64"),
    encodeBase64Run(value, offset, "base64url"),
  ]);
  return [hex, hex.toUpperCase(), ...base64Runs].map((form) => ({
    envVar,
    value: form,
  }));
}

function removeSpacing(text: string): string {
  return text.replace(SPACING, "");
}

/** The ways one secret value can be written; a plain value only as itself. */
function buildSecretForms(envVar: string, part: string): OutputSecret[] {
  const literalValues = [part, escapeForJson(part), removeSpacing(part)];
  const tooPlain = new Set(part).size < MIN_DISTINCT_CHARS;
  const lettersOnly = LETTERS_ONLY.test(part);
  const spellsOutLetters = lettersOnly && !tooPlain;
  if (spellsOutLetters) {
    literalValues.push(Array.from(part).join(" "));
  }
  const matchesExactOnly = tooPlain || lettersOnly;
  const literalForms = matchesExactOnly
    ? literalValues.map((value) => ({ envVar, value, exactMatchOnly: true }))
    : literalValues.map((value) => ({ envVar, value }));
  return tooPlain
    ? literalForms
    : [...literalForms, ...buildEncodedForms(envVar, part)];
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
    const forms = splitSecretValue(envVar, value).flatMap((part) =>
      buildSecretForms(envVar, part),
    );
    const formsByValue = new Map(forms.map((form) => [form.value, form]));
    secrets.push(...formsByValue.values());
  }
  return secrets;
}

function findInString(
  text: string,
  fieldPath: string,
  secrets: readonly OutputSecret[],
): OutputSecretHit | undefined {
  const unspaced = removeSpacing(text);
  const secret = secrets.find((candidate) => {
    const matchesUnspaced =
      candidate.exactMatchOnly !== true && unspaced.includes(candidate.value);
    const matches = text.includes(candidate.value) || matchesUnspaced;
    return matches;
  });
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
function maskLiteralSecrets(
  text: string,
  secrets: readonly OutputSecret[],
): string {
  let masked = text;
  const longestFirst = secrets.toSorted(
    (a, b) => b.value.length - a.value.length,
  );
  for (const secret of longestFirst) {
    masked = masked.replaceAll(secret.value, `[${secret.envVar}]`);
  }
  return masked;
}

/** A spaced secret can only be masked with the spacing closed up, so only such a line loses its spacing. */
function maskSecrets(text: string, secrets: readonly OutputSecret[]): string {
  const masked = maskLiteralSecrets(text, secrets);
  const unspaced = removeSpacing(masked);
  const spacedSecrets = secrets.filter(
    (secret) => secret.exactMatchOnly !== true,
  );
  const maskedUnspaced = maskLiteralSecrets(unspaced, spacedSecrets);
  return maskedUnspaced === unspaced ? masked : maskedUnspaced;
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
