import OpenAI, { type ClientOptions } from "openai";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import type { Logger } from "../contract/generator";
import { GeneratorWarningKinds } from "../contract/types";
import {
  isRefusedRedirect,
  NO_REDIRECT_FETCH_OPTIONS,
  REFUSED_REDIRECT_MESSAGE,
  SDK_LOG_LEVEL,
} from "./utils";
import {
  OpenAiCompatibleCore,
  type OpenAiChatRequest,
  type OpenAiChatTransport,
  type OpenAiStreamChunk,
  type StreamChatOptions,
} from "./openaiCore";

/**
 * Preflight requires the model and structured_outputs so strict routing can succeed.
 * Force require_parameters over configured options; never route around response_format.
 * Seed effort support from advertised reasoning capabilities without spending on a failed probe.
 * Warn on served-model mismatches while preserving the configured origin declaration.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter's own default is "allow", which routes to upstreams that keep
 * request data and may train on it. "deny" can leave a model no upstream,
 * and that request then fails.
 */
const DEFAULT_DATA_COLLECTION = "deny";

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
  /** Injected so tests skip the SDK's retry backoff; absent keeps its default. */
  maxRetries?: number;
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
  const defaultHeaders: Record<string, string> = {};

  if (options.referer) {
    defaultHeaders["HTTP-Referer"] = options.referer;
  }
  if (options.title) {
    defaultHeaders["X-Title"] = options.title;
  }

  const clientOptions: ClientOptions = {
    apiKey: options.apiKey,
    logLevel: SDK_LOG_LEVEL,
    baseURL: options.baseUrl ?? OPENROUTER_BASE_URL,
    defaultHeaders,
    // Explicit nulls keep the SDK from reading OPENAI_ORG_ID,
    // OPENAI_PROJECT_ID and OPENAI_ADMIN_KEY.
    organization: null,
    project: null,
    adminAPIKey: null,
    fetchOptions: NO_REDIRECT_FETCH_OPTIONS,
  };

  if (options.fetch) {
    clientOptions.fetch = options.fetch;
  }
  if (options.maxRetries !== undefined) {
    clientOptions.maxRetries = options.maxRetries;
  }

  const client = new OpenAI(clientOptions);

  const listing = await modelListing(client, options.model);
  if (!listing.ok) {
    return listing;
  }
  if (!listing.value.supportedParameters.includes("structured_outputs")) {
    return configError([
      `model "${options.model}" does not support structured_outputs on OpenRouter — with require_parameters every request would fail`,
    ]);
  }
  const reasoningSupported =
    listing.value.supportedParameters.includes("reasoning");
  if (!reasoningSupported) {
    log(
      `note: ${options.model} lists no reasoning support on OpenRouter — origin will record effort: null`,
    );
  }

  const transport = openRouterTransport(client, {
    requested: options.model,
    reasoningSupported,
    providerRouting: options.providerRouting,
    onMismatch: (served, streamOptions) => {
      // The served id is provider-reported (untrusted): render it through
      // the slug grammar so arbitrary text can't enter logs or the hook.
      const shown = MODEL_SLUG.test(served) ? served : "(unrecognized id)";
      const mismatchMessage = `warning: requested model ${options.model} but the stream reports ${shown} — origin stamp stays the declaration`;
      (streamOptions.log ?? log)(mismatchMessage);
      streamOptions.onWarning?.({
        kind: GeneratorWarningKinds.SERVED_MODEL_MISMATCH,
        message: mismatchMessage,
      });
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
      // Pre-seeded from the preflight, no discovery 400 needed. The
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
    onMismatch: (served: string, streamOptions: StreamChatOptions) => void;
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
          // FIRST, so the operator's own routing can still name a policy.
          data_collection: DEFAULT_DATA_COLLECTION,
          ...config.providerRouting,
          // Forced LAST: routing options can never disable it.
          require_parameters: true,
        },
      };

      if (config.reasoningSupported && effort !== undefined) {
        wireBody.reasoning = { effort };
      }
      const stream = await client.chat.completions.create(
        wireBody,
        options.signal ? { signal: options.signal } : undefined,
      );
      return verifyServedModel(stream, config.requested, (served) =>
        config.onMismatch(served, options),
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
      if (chunk.model !== requested) {
        onMismatch(chunk.model);
      }
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
    if (isRefusedRedirect(error)) {
      return configError([REFUSED_REDIRECT_MESSAGE]);
    }
    // Non-auth statuses and network unreachability may clear on their own,
    // tagged transient so restart self-heal keeps applying.
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
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    if (Reflect.get(entry, "id") !== model) {
      continue;
    }
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
