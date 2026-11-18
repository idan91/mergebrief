import type { Result } from "types/utils";
import { TRACES_PATH } from "./consts";
import {
  TraceSamplers,
  type SamplerConfig,
  type TraceSampler,
  type TracingConfig,
} from "./types";

const OTLP_EXPORTER = "otlp";
const DISABLED_EXPORTER = "none";
const HTTP_PROTOBUF = "http/protobuf";
const FULL_SAMPLE_RATIO = 1;

const SAMPLER_NAMES: readonly string[] = Object.values(TraceSamplers);

function isTraceSampler(value: string): value is TraceSampler {
  return SAMPLER_NAMES.includes(value);
}

// Compose passes an unset variable through as empty, and an empty OTel
// variable means unset.
function readVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

/** `key=value,key=value` with percent-encoded values, the OTel list format. */
export function parseKeyValueList(
  raw: string,
  name: string,
): Result<Record<string, string>, string> {
  const pairs: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    if (entry.trim() === "") {
      continue;
    }
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator).trim();
    const missingKey = separator < 1 || key === "";
    if (missingKey) {
      return { ok: false, error: `${name} has an entry without key=value` };
    }
    const encoded = entry.slice(separator + 1).trim();
    try {
      pairs[key] = decodeURIComponent(encoded);
    } catch {
      return {
        ok: false,
        error: `${name} has a value that is not URL-encoded`,
      };
    }
  }
  return { ok: true, value: pairs };
}

// The URL never appears in an error: it may carry credentials in userinfo.
function resolveTracesUrl(
  env: NodeJS.ProcessEnv,
): Result<string | undefined, string> {
  const tracesEndpoint = readVar(env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  const baseEndpoint = readVar(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  const name =
    tracesEndpoint === undefined
      ? "OTEL_EXPORTER_OTLP_ENDPOINT"
      : "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
  let url = tracesEndpoint;
  const derivesFromBase = url === undefined && baseEndpoint !== undefined;
  if (derivesFromBase) {
    const base = baseEndpoint.replace(/\/+$/, "");
    url = `${base}${TRACES_PATH}`;
  }
  if (url === undefined) {
    return { ok: true, value: undefined };
  }
  if (!URL.canParse(url)) {
    return { ok: false, error: `${name} is not a URL` };
  }
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, error: `${name} is not an http or https URL` };
  }
  return { ok: true, value: url };
}

function resolveSampler(env: NodeJS.ProcessEnv): Result<SamplerConfig, string> {
  const name =
    readVar(env, "OTEL_TRACES_SAMPLER") ?? TraceSamplers.PARENT_BASED_ALWAYS_ON;
  if (!isTraceSampler(name)) {
    return {
      ok: false,
      error: `OTEL_TRACES_SAMPLER must be one of: ${SAMPLER_NAMES.join(", ")}`,
    };
  }
  const rawRatio = readVar(env, "OTEL_TRACES_SAMPLER_ARG");
  const ratio = rawRatio === undefined ? FULL_SAMPLE_RATIO : Number(rawRatio);
  const ratioInRange = Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
  if (!ratioInRange) {
    return {
      ok: false,
      error: "OTEL_TRACES_SAMPLER_ARG must be a number from 0 to 1",
    };
  }
  return { ok: true, value: { name, ratio } };
}

function validateExportSettings(
  env: NodeJS.ProcessEnv,
): Result<undefined, string> {
  const exporter = readVar(env, "OTEL_TRACES_EXPORTER") ?? OTLP_EXPORTER;
  if (exporter !== OTLP_EXPORTER) {
    return { ok: false, error: "OTEL_TRACES_EXPORTER must be otlp or none" };
  }
  const tracesProtocol = readVar(env, "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL");
  const name =
    tracesProtocol === undefined
      ? "OTEL_EXPORTER_OTLP_PROTOCOL"
      : "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL";
  const protocol = tracesProtocol ?? readVar(env, name) ?? HTTP_PROTOBUF;
  if (protocol !== HTTP_PROTOBUF) {
    return {
      ok: false,
      error: `${name} must be ${HTTP_PROTOBUF}, the one OTLP protocol supported`,
    };
  }
  return { ok: true, value: undefined };
}

function isTracingSwitchedOff(env: NodeJS.ProcessEnv): boolean {
  const disabled = readVar(env, "OTEL_SDK_DISABLED")?.toLowerCase() === "true";
  const exporterOff =
    readVar(env, "OTEL_TRACES_EXPORTER") === DISABLED_EXPORTER;
  const switchedOff = disabled || exporterOff;
  return switchedOff;
}

/**
 * Pure env to config decision. Tracing is off (`undefined`) unless an OTLP
 * endpoint is set; a set but invalid variable refuses, so a misconfigured
 * process fails at boot instead of tracing nothing quietly.
 */
export function resolveTracingConfig(
  env: NodeJS.ProcessEnv,
  serviceName: string,
): Result<TracingConfig | undefined, string> {
  if (isTracingSwitchedOff(env)) {
    return { ok: true, value: undefined };
  }
  const url = resolveTracesUrl(env);
  if (!url.ok) {
    return url;
  }
  if (url.value === undefined) {
    return { ok: true, value: undefined };
  }

  const settings = validateExportSettings(env);
  if (!settings.ok) {
    return settings;
  }
  const headersName =
    readVar(env, "OTEL_EXPORTER_OTLP_TRACES_HEADERS") === undefined
      ? "OTEL_EXPORTER_OTLP_HEADERS"
      : "OTEL_EXPORTER_OTLP_TRACES_HEADERS";
  const rawHeaders = readVar(env, headersName) ?? "";
  const headers = parseKeyValueList(rawHeaders, headersName);
  if (!headers.ok) {
    return headers;
  }
  const rawAttributes = readVar(env, "OTEL_RESOURCE_ATTRIBUTES") ?? "";
  const resourceAttributes = parseKeyValueList(
    rawAttributes,
    "OTEL_RESOURCE_ATTRIBUTES",
  );
  if (!resourceAttributes.ok) {
    return resourceAttributes;
  }
  const sampler = resolveSampler(env);
  if (!sampler.ok) {
    return sampler;
  }

  return {
    ok: true,
    value: {
      url: url.value,
      headers: headers.value,
      serviceName: readVar(env, "OTEL_SERVICE_NAME") ?? serviceName,
      resourceAttributes: resourceAttributes.value,
      sampler: sampler.value,
    },
  };
}
