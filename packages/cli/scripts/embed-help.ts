// README flag-appendix generator (BRIEF-17 plan decision 8): runs each
// command's `--help` through the REAL program (commander's structured help
// is the canonical flag contract) and splices the output between the
// README's marker comments. `--check` mode rewrites nothing and exits 1 on
// staleness — the CI gate judges by exit code.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runCli, type CliDeps } from "../src/program";

const README = join(fileURLToPath(new URL("..", import.meta.url)), "README.md");
const BEGIN = "<!-- BEGIN GENERATED FLAG APPENDIX (pnpm docs:appendix) -->";
const END = "<!-- END GENERATED FLAG APPENDIX -->";

const COMMANDS: string[][] = [
  ["--help"],
  ["auth", "login", "--help"],
  ["auth", "status", "--help"],
  ["repos", "--help"],
  ["pr", "--help"],
  ["groups", "--help"],
  ["conversation", "--help"],
  ["diff", "--help"],
  ["delta", "--help"],
  ["reply", "--help"],
  ["submit", "--help"],
];

async function helpText(argv: string[]): Promise<string> {
  const out: string[] = [];
  const deps: CliDeps = {
    fetch: async () => {
      throw new Error("--help must not fetch");
    },
    env: {},
    configDir: "/nonexistent",
    cacheDir: "/nonexistent",
    stdout: (text) => out.push(text),
    stderr: () => undefined,
    readStdin: async () => {
      throw new Error("--help must not read stdin");
    },
    gitOriginUrl: () => undefined,
  };
  const code = await runCli(argv, deps);
  if (code !== 0) {
    throw new Error(`help for "${argv.join(" ")}" exited ${code}`);
  }
  return out.join("").trimEnd();
}

async function buildAppendix(): Promise<string> {
  const sections: string[] = [];
  for (const argv of COMMANDS) {
    const label = argv.slice(0, -1).join(" ") || "mergebrief";
    sections.push(`### \`${label === "mergebrief" ? "mergebrief" : `mergebrief ${label}`}\`\n\n\`\`\`\n${await helpText(argv)}\n\`\`\``);
  }
  return sections.join("\n\n");
}

const readme = readFileSync(README, "utf8");
const beginAt = readme.indexOf(BEGIN);
const endAt = readme.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  console.error("README.md is missing the generated-appendix markers");
  process.exit(1);
}

const appendix = await buildAppendix();
const next =
  readme.slice(0, beginAt + BEGIN.length) + "\n\n" + appendix + "\n\n" + readme.slice(endAt);

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README flag appendix is stale — run: pnpm --dir packages/cli docs:appendix");
    process.exit(1);
  }
  console.info("README flag appendix is current.");
} else {
  writeFileSync(README, next);
  console.info("README flag appendix regenerated.");
}
