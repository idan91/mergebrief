/** On only in the hosted demo build, which `ENABLE_DEMO` switches on. */
export function isDemoBuild(): boolean {
  const flag: unknown = import.meta.env["ENABLE_DEMO"];
  const demoEnabled = flag === "true" || flag === "1" || flag === true;
  return demoEnabled;
}
