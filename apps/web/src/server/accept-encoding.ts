/** The codings the client accepts: listed by name and not weighted `q=0`. */
export function readAcceptedCodings(acceptEncoding: string): Set<string> {
  const accepted = new Set<string>();
  for (const entry of acceptEncoding.split(",")) {
    const [name = "", ...parameters] = entry
      .split(";")
      .map((part) => part.trim());
    const weight = parameters.find((parameter) => parameter.startsWith("q="));
    const refused = weight !== undefined && Number(weight.slice(2)) === 0;
    const isAccepted = name !== "" && !refused;
    if (isAccepted) {
      accepted.add(name.toLowerCase());
    }
  }
  return accepted;
}
