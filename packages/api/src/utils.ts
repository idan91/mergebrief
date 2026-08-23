/** `JSON.parse` that answers `undefined` instead of throwing on bad input. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
