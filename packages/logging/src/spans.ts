// Named spans for the business steps inside a trace. Reads only the no-op
// `@opentelemetry/api`, so with tracing off every call here is inert.
import { SpanStatusCode, trace } from "@opentelemetry/api";

export const TRACER_NAME = "mergebrief";
const HTTP_ROUTE = "http.route";

/** Ids, counts and decision tokens only: never titles, diffs, prompts or error text. */
export type SpanAttributes = Record<string, string | number | boolean>;

export interface SpanHandle {
  setAttributes(attributes: SpanAttributes): void;
  /** For a step that answers its own failure instead of throwing it. */
  markFailed(): void;
  /** False with tracing off or the trace unsampled: nothing will export. */
  isRecording(): boolean;
}

export interface StepSpanOptions {
  /** Whether a throw is a failure for this step; every throw is by default. */
  readonly isFailure?: (error: unknown) => boolean;
}

/**
 * Runs `run` inside a child span of the active one. A throw `isFailure`
 * accepts marks the span failed with no message, since error text can carry
 * provider content; every throw is rethrown.
 */
export async function traceStep<Outcome>(
  name: string,
  attributes: SpanAttributes,
  run: (span: SpanHandle) => Promise<Outcome>,
  options: StepSpanOptions = {},
): Promise<Outcome> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    const handle: SpanHandle = {
      setAttributes: (values) => {
        span.setAttributes(values);
      },
      markFailed: () => {
        span.setStatus({ code: SpanStatusCode.ERROR });
      },
      isRecording: () => span.isRecording(),
    };
    try {
      return await run(handle);
    } catch (error) {
      const failed = options.isFailure?.(error) ?? true;
      if (failed) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("then" in value)) {
    return false;
  }
  return typeof value.then === "function";
}

/**
 * A call outside any trace opens no span, the same as an unparented query. A
 * lazy thenable (a drizzle query builder) is started here, inside the span,
 * so its query nests under it.
 */
function traceCall(
  name: string,
  call: () => unknown,
  isFailure: (error: unknown) => boolean,
): unknown {
  if (trace.getActiveSpan() === undefined) {
    return call();
  }
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, (span) => {
    let result: unknown;
    try {
      result = call();
    } catch (error) {
      if (isFailure(error)) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
      throw error;
    }

    if (!isThenable(result)) {
      span.end();
      return result;
    }
    return result.then(
      (value: unknown) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        if (isFailure(error)) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
        throw error;
      },
    );
  });
}

function isEveryThrowAFailure(): boolean {
  return true;
}

/**
 * Wraps every method of `store` in a span named `<storeName>.<method>`, so
 * the queries a call runs group under the store method that ran them. Records
 * no arguments; a throw or rejection `isFailure` accepts marks the span
 * failed with no message.
 */
export function traceMethods<Store extends object>(
  storeName: string,
  store: Store,
  options: StepSpanOptions = {},
): Store {
  const isFailure = options.isFailure ?? isEveryThrowAFailure;
  return new Proxy(store, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      const isNamedMethod =
        typeof value === "function" && typeof property === "string";
      if (!isNamedMethod) {
        return value;
      }
      const spanName = `${storeName}.${property}`;
      return (...args: unknown[]): unknown =>
        traceCall(
          spanName,
          () => Reflect.apply(value, target, args),
          isFailure,
        );
    },
  });
}

export function nameRequestSpan(method: string, route: string): void {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return;
  }
  span.updateName(`${method} ${route}`);
  span.setAttribute(HTTP_ROUTE, route);
}
