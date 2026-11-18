import { describe, expect, it } from "vitest";
import {
  parseKeyValueList,
  resolveTracingConfig,
} from "../../src/tracing/config";

const SERVICE = "mergebrief-test";
const ENDPOINT = "http://collector:4318";

function resolveOn(env: NodeJS.ProcessEnv) {
  const resolved = resolveTracingConfig(
    { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, ...env },
    SERVICE,
  );
  if (!resolved.ok || resolved.value === undefined) {
    throw new Error(`expected tracing on, got ${JSON.stringify(resolved)}`);
  }
  return resolved.value;
}

function resolveRefusal(env: NodeJS.ProcessEnv): string {
  const resolved = resolveTracingConfig(env, SERVICE);
  if (resolved.ok) {
    throw new Error("expected a refusal");
  }
  return resolved.error;
}

describe("resolveTracingConfig switch", () => {
  it("is off when no OTLP endpoint is set", () => {
    expect(resolveTracingConfig({}, SERVICE)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("treats an empty endpoint as unset", () => {
    const resolved = resolveTracingConfig(
      { OTEL_EXPORTER_OTLP_ENDPOINT: "" },
      SERVICE,
    );
    expect(resolved).toEqual({ ok: true, value: undefined });
  });

  it("is off under OTEL_SDK_DISABLED even with an endpoint", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_SDK_DISABLED: "TRUE",
    };
    expect(resolveTracingConfig(env, SERVICE)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("is off when OTEL_TRACES_EXPORTER is none", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_TRACES_EXPORTER: "none",
    };
    expect(resolveTracingConfig(env, SERVICE)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("resolveTracingConfig endpoint", () => {
  it("appends the traces path to the base endpoint", () => {
    expect(resolveOn({ OTEL_EXPORTER_OTLP_ENDPOINT: `${ENDPOINT}/` }).url).toBe(
      `${ENDPOINT}/v1/traces`,
    );
  });

  it("uses the traces endpoint as given, ahead of the base", () => {
    const url = resolveOn({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.example/t",
    }).url;
    expect(url).toBe("https://otlp.example/t");
  });

  it("refuses a value that is not an http URL without echoing it", () => {
    const error = resolveRefusal({
      OTEL_EXPORTER_OTLP_ENDPOINT: "grpc://user:pw@host:4317",
    });
    expect(error).toMatch(
      /OTEL_EXPORTER_OTLP_ENDPOINT is not an http or https URL/,
    );
    expect(error).not.toContain("pw");
    expect(
      resolveRefusal({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "nope" }),
    ).toMatch(/OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is not a URL/);
  });

  it("refuses a protocol other than http/protobuf", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
    };
    expect(resolveRefusal(env)).toMatch(
      /^OTEL_EXPORTER_OTLP_PROTOCOL must be http\/protobuf/,
    );
  });

  it("refuses an exporter other than otlp or none", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_TRACES_EXPORTER: "zipkin",
    };
    expect(resolveRefusal(env)).toMatch(
      /OTEL_TRACES_EXPORTER must be otlp or none/,
    );
  });
});

describe("resolveTracingConfig headers and resource", () => {
  it("decodes the header list, the traces list winning", () => {
    expect(
      resolveOn({ OTEL_EXPORTER_OTLP_HEADERS: "dd-api-key=a%3Db, x=1" })
        .headers,
    ).toEqual({
      "dd-api-key": "a=b",
      x: "1",
    });
    const headers = resolveOn({
      OTEL_EXPORTER_OTLP_HEADERS: "x=1",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "y=2",
    }).headers;
    expect(headers).toEqual({ y: "2" });
  });

  it("refuses a header entry without a key", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: "=secret",
    };
    const error = resolveRefusal(env);
    expect(error).toMatch(
      /OTEL_EXPORTER_OTLP_HEADERS has an entry without key=value/,
    );
    expect(error).not.toContain("secret");
  });

  it("names the traces header variable when that one is malformed", () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x",
    };
    expect(resolveRefusal(env)).toMatch(
      /^OTEL_EXPORTER_OTLP_TRACES_HEADERS has an entry/,
    );
  });

  it("names the service, letting OTEL_SERVICE_NAME override it", () => {
    const config = resolveOn({
      OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod",
    });
    expect(config.resourceAttributes).toEqual({
      "deployment.environment": "prod",
    });
    expect(config.serviceName).toBe(SERVICE);
    expect(resolveOn({ OTEL_SERVICE_NAME: "custom" }).serviceName).toBe(
      "custom",
    );
  });
});

describe("resolveTracingConfig sampler", () => {
  it("defaults to parent-based always-on", () => {
    expect(resolveOn({}).sampler).toEqual({
      name: "parentbased_always_on",
      ratio: 1,
    });
  });

  it("reads the ratio for traceidratio", () => {
    const sampler = resolveOn({
      OTEL_TRACES_SAMPLER: "traceidratio",
      OTEL_TRACES_SAMPLER_ARG: "0.25",
    }).sampler;
    expect(sampler).toEqual({ name: "traceidratio", ratio: 0.25 });
  });

  it("refuses an unknown sampler and an out-of-range ratio", () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT };
    expect(
      resolveRefusal({ ...base, OTEL_TRACES_SAMPLER: "jaeger_remote" }),
    ).toMatch(/OTEL_TRACES_SAMPLER must be one of/);
    expect(resolveRefusal({ ...base, OTEL_TRACES_SAMPLER_ARG: "2" })).toMatch(
      /OTEL_TRACES_SAMPLER_ARG must be a number from 0 to 1/,
    );
  });
});

describe("parseKeyValueList", () => {
  it("skips blank entries and keeps an equals sign inside a value", () => {
    expect(parseKeyValueList(" a=1,, b = x=y ", "LIST")).toEqual({
      ok: true,
      value: { a: "1", b: "x=y" },
    });
  });

  it("refuses a value that is not URL-encoded", () => {
    expect(parseKeyValueList("a=%E0%A4%A", "LIST")).toEqual({
      ok: false,
      error: "LIST has a value that is not URL-encoded",
    });
  });
});
