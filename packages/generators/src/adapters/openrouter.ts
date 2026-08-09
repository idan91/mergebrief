import OpenAI from "openai";
import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import type { Logger } from "../contract/generator";
import {
  OpenAiCompatibleCore,
  type OpenAiChatRequest,
  type OpenAiChatTransport,
  type OpenAiStreamChunk,
} from "./openaiCore";

/**
 * OpenRouter assembly on the shared core (ADR 0030): the same streaming
 * pipeline with OpenRouter's own request/verification surface —
 *
 * 1. `/models` boot preflight: the configured slug must exist AND list
 *    `structured_outputs` in `supported_parameters` — with
 *    `require_parameters: true` every request would otherwise fail at
 *    routing time; refusing boot is the honest fail-fast. The model's
 *    `supported_parameters` are cached to gate the reasoning knob.
 * 2. Every request carries `provider.require_parameters: true` (forced,
 *    merged OVER any configured routing options): OpenRouter must never
 *    silently route to a provider that ignores `response_format`.
 * 3. Effort translates to OpenRouter's `reasoning: { effort }` shape, sent
 *    only when the model listed `reasoning` support — the core's knob
 *    discovery is pre-seeded from the preflight, so the origin stamp records the
 *    gap without burning a 400 (ADR 0013 #5).
 * 4. Trust-but-verify: stream chunks carry the served model id; a mismatch
 *    against the configured slug logs a warning and fires the hook — the
 *    origin stamp stays the declaration.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter slug grammar (author/model with dots, dashes, colons). */
const MODEL_SLUG = /^[\w.:-]+\/[\w.:-]+$/;

export interface OpenRouterAssemblyOptions {
  apiKey: string;
  /** Full OpenRouter slug, e.g. "anthropic/claude-opus-4.8". */
  model: string;
  failureDir: string;
  /** Routing options merged UNDER the forced require_parameters. */
  providerRouting?: Record<string, unknown> | undefined;
  /** Attribution headers (HTTP-Referer / X-Title). */
  referer?: string | undefined;
  title?: string | undefined;
  onModelMismatch?: ((requested: string, served: string) => void) | undefined;
  log?: Logger | undefined;
  /** Injected for fetch-level test fixtures; also overrides the base URL
   * host in tests. */
  fetch?: typeof globalThis.fetch | undefined;
  baseUrl?: string | undefined;
}

/** The `/models` entry slice the preflight reads. */
interface ModelListing {
  id: string;
  supportedParameters: string[];
}

export async function createOpenRouterCore(
  options: OpenRouterAssemblyOptions,
): Promise<Result<OpenAiCompatibleCore, ConfigError>> {
  const log = options.log ?? (() => {});
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl ?? OPENROUTER_BASE_URL,
    defaultHeaders: {
      ...(options.referer ? { "HTTP-Referer": options.referer } : {}),
      ...(options.title ? { "X-Title": options.title } : {}),
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const listing = await modelListing(client, options.model);
  if (!listing.ok) return listing;
  if (!listing.value.supportedParameters.includes("structured_outputs")) {
    return configError([
      `model "${options.model}" does not support structured_outputs on OpenRouter — with require_parameters every request would fail`,
    ]);
  }
  const reasoningSupported =
    listing.value.supportedParameters.includes("reasoning");
  if (!reasoningSupported) {
    log(
      `note: ${options.model} lists no reasoning support on OpenRouter — provenance will record effort: null`,
    );
  }

  const transport = openRouterTransport(client, {
    requested: options.model,
    reasoningSupported,
    providerRouting: options.providerRouting,
    onMismatch: (served, requestLog) => {
      // The served id is provider-reported (untrusted): render it through
      // the slug grammar so arbitrary text can't enter logs or the hook.
      // The warning goes through the PER-REQUEST log so it reaches the
      // caller's artifact-warning collection, not just the process log.
      const shown = MODEL_SLUG.test(served) ? served : "(unrecognized id)";
      (requestLog ?? log)(
        `warning: requested model ${options.model} but the stream reports ${shown} — provenance stamp stays the declaration`,
      );
      options.onModelMismatch?.(options.model, shown);
    },
  });

  return {
    ok: true,
    value: new OpenAiCompatibleCore({
      transport,
      provider: "openrouter",
      model: options.model,
      failureDir: options.failureDir,
      // Pre-seeded from the preflight — no discovery 400 needed. The
      // backstop stays armed for a listing that lied: our wrapper puts
      // `reasoning` on the wire, so a knob rejection names THAT.
      initialEffortSupported: reasoningSupported,
      knobRejectionMarker: "reasoning",
    }),
  };
}

/** The wire body: the core's request minus its knob, plus OpenRouter's
 * extension blocks. Width-subtyping keeps this assignable to the SDK's
 * streaming params without casts. */
type OpenRouterWireBody = Omit<OpenAiChatRequest, "reasoning_effort"> & {
  provider: Record<string, unknown>;
  reasoning?: { effort: string };
};

/** Wrap the SDK into the core's boundary, translating OpenRouter extensions. */
function openRouterTransport(
  client: OpenAI,
  config: {
    requested: string;
    reasoningSupported: boolean;
    providerRouting: Record<string, unknown> | undefined;
    onMismatch: (served: string, requestLog: Logger | undefined) => void;
  },
): OpenAiChatTransport {
  return {
    streamChat: async (body, options) => {
      // Effort travels as OpenRouter's `reasoning: { effort }`; the core's
      // reasoning_effort never goes on the wire here.
      const { reasoning_effort: effort, ...rest } = body;
      const wireBody: OpenRouterWireBody = {
        ...rest,
        provider: {
          ...config.providerRouting,
          // Forced LAST: routing options can never disable it.
          require_parameters: true,
        },
        ...(config.reasoningSupported && effort !== undefined
          ? { reasoning: { effort } }
          : {}),
      };
      const stream = await client.chat.completions.create(
        wireBody,
        options.signal ? { signal: options.signal } : undefined,
      );
      return verifyServedModel(stream, config.requested, (served) =>
        config.onMismatch(served, options.log),
      );
    },
  };
}

/** Pass chunks through, checking the first served-model id seen. */
async function* verifyServedModel(
  stream: AsyncIterable<OpenAiStreamChunk & { model?: string }>,
  requested: string,
  onMismatch: (served: string) => void,
): AsyncIterable<OpenAiStreamChunk> {
  let verified = false;
  for await (const chunk of stream) {
    if (!verified && typeof chunk.model === "string" && chunk.model !== "") {
      verified = true;
      if (chunk.model !== requested) onMismatch(chunk.model);
    }
    yield chunk;
  }
}

/** GET /models and locate the configured slug. */
async function modelListing(
  client: OpenAI,
  model: string,
): Promise<Result<ModelListing, ConfigError>> {
  let payload: unknown;
  try {
    payload = await client.get("/models");
  } catch (error) {
    const status =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "status")
        : undefined;
    if (status === 401 || status === 403) {
      return configError([
        "OpenRouter rejected the API key (401/403) — check the configured apiKeyEnv variable's value",
      ]);
    }
    // Non-auth statuses and network unreachability may clear on their own —
    // tagged transient so restart self-heal keeps applying (BRIEF-149).
    return configError(
      [
        `OpenRouter /models preflight failed${typeof status === "number" ? ` (status ${status})` : " (network/config error)"}`,
      ],
      { transient: true },
    );
  }
  const data =
    typeof payload === "object" && payload !== null
      ? Reflect.get(payload, "data")
      : undefined;
  if (!Array.isArray(data)) {
    return configError(["OpenRouter /models returned an unrecognized shape"]);
  }
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    if (Reflect.get(entry, "id") !== model) continue;
    const supported = Reflect.get(entry, "supported_parameters");
    return {
      ok: true,
      value: {
        id: model,
        supportedParameters: Array.isArray(supported)
          ? supported.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      },
    };
  }
  return configError([`model "${model}" not found on OpenRouter`]);
}
