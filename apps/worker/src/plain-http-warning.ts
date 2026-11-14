import type { PlainHttpWarning } from "generators";

export interface PlainHttpLogLine {
  message: string;
  fields: { evt: "generator.plain-http"; host: string };
}

/** The generator's plain-http boot warning as the worker logs it. */
export function shapePlainHttpLogLine(
  warning: PlainHttpWarning,
): PlainHttpLogLine {
  return {
    message: warning.message,
    fields: { evt: "generator.plain-http", host: warning.host },
  };
}
