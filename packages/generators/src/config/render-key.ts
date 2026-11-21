/** Keys echo only when token-shaped: short, letters and dashes ONLY; key
 * material is digit-bearing (sk-or-abc123…), so digits disqualify. Same
 * grammar as the registry's CONFIG_KEY_TOKEN. */
const CONFIG_KEY_ECHO_TOKEN = /^[A-Za-z][A-Za-z-]{0,19}$/;

export function renderKey(key: string): string {
  return CONFIG_KEY_ECHO_TOKEN.test(key) ? `"${key}"` : "(redacted)";
}
