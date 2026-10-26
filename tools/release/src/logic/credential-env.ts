export type ChildEnv = Readonly<Record<string, string | undefined>>;

const CREDENTIAL_WORDS = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;
const KEY_SEGMENT = /(?:^|_)KEY(?:_|$)/i;
// Config passed through the environment goes as one group: GIT_CONFIG_COUNT
// needs every KEY_<n> and VALUE_<n> below it, and a value can carry a
// credential such as an `http.extraheader`.
const GIT_CONFIG_GROUP = /^GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$/;

function isCredentialName(name: string): boolean {
  const credentialShaped =
    CREDENTIAL_WORDS.test(name) ||
    KEY_SEGMENT.test(name) ||
    GIT_CONFIG_GROUP.test(name);
  return credentialShaped;
}

/** `env` without any variable whose name looks like a credential; every child the export spawns starts from this. */
export function stripCredentialVariables(env: ChildEnv): ChildEnv {
  const kept = Object.entries(env).filter(([name]) => !isCredentialName(name));
  return Object.fromEntries(kept);
}
