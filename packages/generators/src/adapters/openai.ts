import OpenAI from "openai";
import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import type { Logger } from "../contract/generator";
import { OpenAiCompatibleCore, type OpenAiChatTransport } from "./openaiCore";

/**
 * The openai-provider assembly on the shared core: official SDK client,
 * `/models/{id}` boot preflight (key validity + model existence in one
 * call), and the `baseURL` escape hatch for self-hosted compatible servers
 * (preflight failures downgrade to warnings there — a llama.cpp box may not
 * implement /models, and refusing boot over the probe would be wrong).
 */

export interface OpenAiAssemblyOptions {
  apiKey: string;
  model: string;
  failureDir: string;
  baseUrl?: string | undefined;
  /** Attribution headers (openrouter sets referer/title, PR 8). */
  defaultHeaders?: Record<string, string> | undefined;
  /** Provenance provider token; "openai" here, "openrouter" in PR 8. */
  provider: string;
  log?: Logger | undefined;
  /** Injected for fetch-level test fixtures. */
  fetch?: typeof globalThis.fetch | undefined;
}

/** Wrap the official SDK into the core's transport seam. */
export function sdkTransport(client: OpenAI): OpenAiChatTransport {
  return {
    streamChat: async (body, options) =>
      client.chat.completions.create(
        body,
        options.signal ? { signal: options.signal } : undefined,
      ),
  };
}

/**
 * Construct the SDK client + core, then run the boot preflight. Returns
 * Result — a misconfigured instance refuses boot (unless baseUrl is set,
 * where probe failures become warnings).
 */
export async function createOpenAiCore(
  options: OpenAiAssemblyOptions,
): Promise<Result<OpenAiCompatibleCore, ConfigError>> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    ...(options.defaultHeaders
      ? { defaultHeaders: options.defaultHeaders }
      : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const log = options.log ?? (() => {});

  const probe = await modelPreflight(client, options.model);
  if (!probe.ok) {
    if (options.baseUrl === undefined) return probe;
    // Escape hatch: self-hosted compatible servers may not implement
    // /models — boot proceeds, loudly. The URL is logged without userinfo,
    // query or fragment (any of which could carry credentials).
    log(
      `warning: ${options.provider} preflight against ${sanitizedOrigin(options.baseUrl)} failed (${probe.error.issues.join("; ")}) — continuing because baseUrl is set`,
    );
  }

  return {
    ok: true,
    value: new OpenAiCompatibleCore({
      transport: sdkTransport(client),
      provider: options.provider,
      model: options.model,
      failureDir: options.failureDir,
    }),
  };
}

/** Origin + path only — no userinfo, query, or fragment. */
function sanitizedOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "(unparseable baseUrl)";
  }
}

/**
 * `/models/{id}` as the boot probe: 401 → bad key, 404 → bad model id, one
 * request for both. Messages carry status + model id only — never the key.
 */
async function modelPreflight(
  client: OpenAI,
  model: string,
): Promise<Result<undefined, ConfigError>> {
  try {
    await client.models.retrieve(model);
    return { ok: true, value: undefined };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "status")
        : undefined;
    if (status === 401 || status === 403) {
      return configError([
        "provider API key was rejected (401/403) — check the configured apiKeyEnv variable's value",
      ]);
    }
    if (status === 404) {
      return configError([`model "${model}" not found on this provider`]);
    }
    // 429/5xx and network unreachability may clear on their own — tagged
    // transient so the compose worker's restart self-heal keeps applying
    // (BRIEF-149). 401/403/404 above are deterministic: retry can't fix them.
    if (typeof status === "number") {
      return configError(
        [`model preflight failed with status ${status} for "${model}"`],
        { transient: true },
      );
    }
    return configError(
      [`model preflight could not reach the provider (network/config error)`],
      { transient: true },
    );
  }
}
