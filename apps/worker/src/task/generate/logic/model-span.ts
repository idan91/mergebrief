import { Providers, type Generator, type TokenUsage } from "generators";
import { traceStep, type SpanAttributes, type SpanHandle } from "logging";

const GEN_AI_OPERATION = "chat";
/** Reported for a provider with no effort knob. */
const NO_EFFORT = "none";

interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

function recordUsage(span: SpanHandle, totals: UsageTotals): void {
  if (totals.requests === 0) {
    return;
  }
  span.setAttributes({
    "gen_ai.usage.input_tokens": totals.inputTokens,
    "gen_ai.usage.output_tokens": totals.outputTokens,
    "gen_ai.usage.cache_read.input_tokens": totals.cacheReadTokens,
    "mergebrief.provider_requests": totals.requests,
  });
}

/**
 * One GenAI span per generation (`chat <model>`): provider, model, effort and
 * the artifact it produces, plus token usage summed over the provider's own
 * retries, the input total counting cache reads and writes for Anthropic and
 * OpenAI-compatible providers. Adapters without per-call usage leave the counts off. Prompts and
 * output never reach the span. The usage listener rides only a recording
 * span: an OpenAI-compatible adapter asks the provider for usage only when one
 * is set, so with tracing off the request goes out as it did before.
 */
export function traceProviderCalls(
  generator: Generator,
  stop?: AbortSignal,
): Generator {
  // An abort the run asked for (a push, shutdown) is not a failed call.
  const isFailure = (): boolean => stop?.aborted !== true;
  return {
    generate: (req) => {
      const origin = generator.origin(req.effort);
      const attributes: SpanAttributes = {
        "gen_ai.operation.name": GEN_AI_OPERATION,
        "gen_ai.provider.name": origin.provider,
        "gen_ai.request.model": origin.model,
        "mergebrief.generation.kind": req.label,
        "mergebrief.generation.effort": origin.effort ?? NO_EFFORT,
      };
      const spanName = `${GEN_AI_OPERATION} ${origin.model}`;
      // GenAI's input total includes cache reads and writes; Anthropic reports
      // both apart from its input count, OpenAI-compatible providers inside it.
      const cacheTokensApart = origin.provider === Providers.ANTHROPIC;
      return traceStep(
        spanName,
        attributes,
        async (span) => {
          if (!span.isRecording()) {
            return generator.generate(req);
          }
          const totals: UsageTotals = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
          };
          const sumUsage = (usage: TokenUsage): void => {
            totals.requests += 1;
            totals.inputTokens += usage.inputTokens;
            if (cacheTokensApart) {
              const cacheTokens =
                usage.cacheReadTokens + (usage.cacheWriteTokens ?? 0);
              totals.inputTokens += cacheTokens;
            }
            totals.outputTokens += usage.outputTokens;
            totals.cacheReadTokens += usage.cacheReadTokens;
            req.onUsage?.(usage);
          };
          try {
            return await generator.generate({ ...req, onUsage: sumUsage });
          } finally {
            recordUsage(span, totals);
            // A provider that refused the effort knob mid-call serves none.
            const served = generator.origin(req.effort).effort ?? NO_EFFORT;
            span.setAttributes({ "mergebrief.generation.effort": served });
          }
        },
        { isFailure },
      );
    },
    origin: (effort) => generator.origin(effort),
  };
}
