/** The response header the API stamps past the session layer. */
export const VERSION_HEADER = "mergebrief-version";

/** Any value silences the nag and the major-gap warning; the failure suffix stays. */
export const NO_VERSION_WARNING_ENV = "MERGEBRIEF_NO_VERSION_WARNING";

/** `npm_command=exec` is how npm says the binary runs under `npx`. */
export const NPM_COMMAND_ENV = "npm_command";
export const NPM_EXEC_COMMAND = "exec";

/** Versions the CLI never compares or warns about. */
export const DEV_VERSIONS: ReadonlySet<string> = new Set(["dev", "0.0.0"]);

export const PACKAGE_NAME = "mergebrief";

export const CLI_BEHIND_REASON = "some commands may fail";
export const SERVER_BEHIND_REASON = "some commands may not exist there";
export const MAJOR_GAP_SUFFIX = "major gap";
