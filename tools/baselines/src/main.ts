// The baseline gate's composition root: argv and the environment enter here
// and the exit code is the verdict. Everything below takes its inputs as
// parameters.
import { BASE_REF_ENV_VAR, DEFAULT_BASE_REF } from "./consts";
import { checkBaselines } from "./gate";
import { renderVerdict } from "./logic/report";

/** `--base <ref>`, else the environment, else the documented default. */
function readBaseRef(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const flag = argv.indexOf("--base");
  const named = flag === -1 ? undefined : argv[flag + 1];
  if (named !== undefined && named.length > 0) {
    return named;
  }
  const fromEnv = env[BASE_REF_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_BASE_REF;
}

const result = checkBaselines(
  process.cwd(),
  readBaseRef(process.argv.slice(2), process.env),
);

if (!result.ok) {
  process.stderr.write(`baselines: ${result.error.message}\n`);
  process.exitCode = 1;
} else {
  const { baseCommit, verdict } = result.value;
  process.stdout.write(`${renderVerdict(baseCommit, verdict)}\n`);
  process.exitCode = verdict.findings.length === 0 ? 0 : 1;
}
