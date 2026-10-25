// `runCli` is the whole CLI behind an injected-deps boundary, command tests
// run it against the REAL api Hono app and assert the contract surface:
// exit 0 ⇒ stdout is documented JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line.
import { Command } from "commander";
import type { Mutable } from "types";
import { CliError, ExitCodes } from "./exit";
import {
  buildFailureSuffix,
  buildMajorWarning,
  deriveSkew,
  detectLaunchForm,
  NO_VERSION_WARNING_ENV,
  readObservedServerVersion,
} from "./version";
import { registerAuthCommands, registerReposCommand } from "./commands/auth";
import { registerCapabilitiesCommand } from "./commands/capabilities";
import { registerSpendCommand } from "./commands/spend";
import {
  registerContextCommand,
  registerMarksCommand,
  registerNarrativeCommand,
  registerSessionCommand,
} from "./commands/session-read";
import {
  registerChunkReadCommand,
  registerDraftCommands,
  registerOutcomeCommand,
  registerReclassifyCommand,
  registerRiskCommands,
} from "./commands/session-write";
import {
  registerCollaboratorsCommand,
  registerConversationCommand,
  registerDeltaCommand,
  registerDiffCommand,
  registerGenerationCommand,
  registerGroupsCommand,
  registerPrCommand,
} from "./commands/read";
import {
  registerGenerateCommand,
  registerReadyCommand,
  registerReplyCommand,
  registerSubmitCommand,
  registerThreadCommands,
} from "./commands/write";
import { resolveCliVersion } from "./commands/target";
import type { CliDeps, CommandContext, GlobalOptions } from "./types";
import { isRecord } from "./utils";

/** Build the commander program over injected deps. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command("mergebrief");
  program
    .description(
      "MergeBrief: PR briefs for humans and agents, over your deployment's API",
    )
    .version(resolveCliVersion(deps))
    .option("--json", "machine output: the documented JSON contract", false)
    .option("--agents", "deprecated: prints where the agent guide moved", false)
    .option(
      "--profile <name>",
      "config profile (default: owners match, then the default profile)",
    )
    .option(
      "-R, --repo <owner/name>",
      "target repository (default: the origin remote)",
    )
    .exitOverride()
    // Fixed help width: the README appendix embeds this output, so wrapping
    // must not depend on the generating terminal.
    .configureHelp({ helpWidth: 80 })
    .configureOutput({
      writeOut: (str) => deps.stdout(str),
      writeErr: (str) => deps.stderr(str.trimEnd()),
    });

  const context: CommandContext = {
    deps,
    readGlobals: () => readGlobalOptions(program),
  };

  registerAuthCommands(program, context);
  registerReposCommand(program, context);
  registerPrCommand(program, context);
  registerGenerationCommand(program, context);
  registerGroupsCommand(program, context);
  registerConversationCommand(program, context);
  registerDiffCommand(program, context);
  registerReplyCommand(program, context);
  registerSubmitCommand(program, context);
  registerSessionCommand(program, context);
  registerMarksCommand(program, context);
  registerNarrativeCommand(program, context);
  registerContextCommand(program, context);
  registerDraftCommands(program, context);
  registerChunkReadCommand(program, context);
  registerRiskCommands(program, context);
  registerReclassifyCommand(program, context);
  registerOutcomeCommand(program, context);
  registerThreadCommands(program, context);
  registerReadyCommand(program, context);
  registerGenerateCommand(program, context);
  registerCollaboratorsCommand(program, context);
  registerCapabilitiesCommand(program, context);
  registerSpendCommand(program, context);
  registerDeltaCommand(program, context);

  return program;
}

function readGlobalOptions(program: Command): GlobalOptions {
  const opts = program.opts<{
    json: boolean;
    profile?: string;
    repo?: string;
  }>();
  const globalOptions: Mutable<GlobalOptions> = { json: opts.json };

  if (opts.profile !== undefined) {
    globalOptions.profile = opts.profile;
  }
  if (opts.repo !== undefined) {
    globalOptions.repo = opts.repo;
  }

  return globalOptions;
}

const AGENTS_MOVED = `The packaged agent guide moved: it now ships as the \`mergebrief\`
agent skill, alongside the CLI in its repository (skills/mergebrief).
Install it into your agent with skills.sh:

    npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>

The MergeBrief repository README carries the install command; substitute
your deployment's <owner>/<repo>. With the skill installed, your agent
needs nothing from this flag.
`;

/** After a successful command: one stderr line when the CLI and the server differ by a major. */
function warnOnMajorGap(deps: CliDeps): void {
  if (deps.env[NO_VERSION_WARNING_ENV] !== undefined) {
    return;
  }
  const skew = deriveSkew(
    readObservedServerVersion(deps),
    resolveCliVersion(deps),
  );
  const warning = buildMajorWarning(skew, detectLaunchForm(deps.env));
  if (warning !== undefined) {
    deps.stderr(warning);
  }
}

/** The one error line's tail while versions differ: `[server x, cli y]`. */
function describeSkewSuffix(deps: CliDeps): string {
  const skew = deriveSkew(
    readObservedServerVersion(deps),
    resolveCliVersion(deps),
  );
  return buildFailureSuffix(skew);
}

/**
 * Run the CLI: parse + execute + map every failure to the stream/exit
 * invariant. Returns the process exit code; never throws.
 */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  if (argv.includes("--agents")) {
    deps.stdout(AGENTS_MOVED);
    return ExitCodes.OK;
  }
  try {
    await buildProgram(deps).parseAsync([...argv], { from: "user" });
    warnOnMajorGap(deps);
    return ExitCodes.OK;
  } catch (error) {
    if (error instanceof CliError) {
      deps.stderr(`${error.message}${describeSkewSuffix(deps)}`);
      return error.code;
    }
    // Commander's own exits (bad flags, --help). Help/version are success.
    if (isRecord(error) && typeof error["code"] === "string") {
      const code = error["code"];
      if (
        code === "commander.helpDisplayed" ||
        code === "commander.help" ||
        code === "commander.version"
      ) {
        return ExitCodes.OK;
      }
      // Usage errors already printed one line via configureOutput.
      return ExitCodes.USAGE;
    }
    const message = error instanceof Error ? error.message : "unexpected error";
    deps.stderr(`${message}${describeSkewSuffix(deps)}`);
    return ExitCodes.GENERIC;
  }
}
