// The tree checks' composition root: argv enters here, the repo root is
// resolved from this file's location, and the exit code is the verdict.
import { fileURLToPath } from "node:url";

import { checkEnvExample } from "./env-example";
import { checkProvenance } from "./provenance";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const USAGE = "usage: repo-checks provenance | env\n";

function runProvenance(): number {
  const result = checkProvenance(REPO_ROOT);
  if (!result.ok) {
    process.stderr.write(`provenance: ${result.error}\n`);
    return 1;
  }

  for (const hit of result.value) {
    process.stderr.write(
      `${hit.path}:${String(hit.line)}: ${hit.kind} citation \`${hit.match}\`; name the decision, cite it in the commit or PR body\n`,
    );
  }
  if (result.value.length > 0) {
    return 1;
  }
  process.stdout.write(
    "provenance: no ticket, handle or pull request citation\n",
  );
  return 0;
}

function runEnv(): number {
  const result = checkEnvExample(REPO_ROOT);
  if (!result.ok) {
    process.stderr.write(`env: ${result.error}\n`);
    return 1;
  }

  const { missing, staleExemptions, unlistedReaders, staleReaderSkips } =
    result.value;
  for (const gap of missing) {
    process.stderr.write(
      `.env.example: ${gap.key} is read by ${gap.paths.join(", ")} but never named\n`,
    );
  }
  for (const key of staleExemptions) {
    process.stderr.write(
      `env: exemption ${key} names a key no parser reads; drop it\n`,
    );
  }
  for (const path of unlistedReaders) {
    process.stderr.write(
      `env: ${path} reads the environment but is neither in ENV_PARSER_PATHS nor ENV_READER_SKIPS\n`,
    );
  }
  for (const path of staleReaderSkips) {
    process.stderr.write(
      `env: ENV_READER_SKIPS names ${path}, which no longer reads the environment; drop it\n`,
    );
  }
  const problems =
    missing.length +
    staleExemptions.length +
    unlistedReaders.length +
    staleReaderSkips.length;
  if (problems > 0) {
    return 1;
  }
  process.stdout.write(
    "env: every config key the servers read is in .env.example\n",
  );
  return 0;
}

const COMMANDS: Readonly<Record<string, () => number>> = {
  provenance: runProvenance,
  env: runEnv,
};

const command = COMMANDS[process.argv[2] ?? ""];
if (command === undefined) {
  process.stderr.write(USAGE);
  process.exitCode = 1;
} else {
  process.exitCode = command();
}
