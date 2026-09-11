import type { LinearPrStack, PrStack } from "../../../../types";

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
}

/** Swap the pull number in a GitHub PR URL; undefined when the path is not a pull. */
export function rewritePullUrl(
  url: string,
  number: number,
): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/\/pull\/\d+(?:\/|$)/.test(parsed.pathname)) return undefined;
    parsed.pathname = parsed.pathname.replace(
      /\/pull\/\d+/,
      `/pull/${String(number)}`,
    );
    return parsed.toString();
  } catch {
    return undefined;
  }
}
