// `runCli` is the whole CLI behind an injected-deps boundary, command tests
// run it against the REAL api Hono app and assert the contract surface:
// exit 0 ⇒ stdout is documented JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line.
import { Command } from "commander";
import { ProductActionIds } from "contract";
import type { Mutable } from "types";
import { CliError, ExitCodes } from "./exit";
import {
  buildFailureSuffix,
  buildMajorWarning,
  deriveSkew,
  detectLaunchForm,
  NO_VERSION_WARNING_ENV,
} from "./version";
import { registerAuthCommands, registerReposCommand } from "./commands/auth";
import { registerCapabilitiesCommand } from "./commands/capabilities";
import {
  registerCollaboratorsCommand,
  registerConversationCommand,
  registerDeltaCommand,
  registerDiffCommand,
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
import {
  requireComparisonSpan,
  requireNarrativeSpan,
  runContext,
  runMarks,
  runNarrative,
  runSession,
} from "./commands/session-read";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
  buildRiskPayload,
  buildUpdateDraftPayload,
  resolveReadFlag,
  runSessionOperation,
  type AnchorFlags,
  type CreateDraftInput,
  type ReanchorInput,
  type RiskOperationId,
  type UpdateDraftInput,
} from "./commands/session-write";
import { runAttach, type AttachDraftTarget } from "./commands/attach";
import {
  parsePrNumber,
  readObservedServerVersion,
  resolveCliVersion,
  resolveRepoTarget,
} from "./commands/target";
import { readAttachmentFile, readPayload } from "./commands/inputs";
import {
  addAnchorOptions,
  addPayloadOption,
  addSpanOptions,
  FULL_PAYLOAD_DESCRIPTION,
  REQUIRED_PAYLOAD_DESCRIPTION,
  REVIEW_OUTCOME_CHOICES,
  requireSpan,
} from "./commands/options";
import type { CliDeps, CommandContext, GlobalOptions } from "./types";
import { isRecord } from "./utils";

/** Build the commander program over injected deps. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command("mergebrief");
  program
    .description(
      "MergeBrief — PR briefs for humans and agents, over your deployment's API",
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

function registerSessionCommand(
  program: Command,
  context: CommandContext,
): void {
  const session = program
    .command("session")
    .description("your review session on the brief span you name")
    .argument("<number>", "PR number");
  addSpanOptions(session).action(
    async (raw: string, options: { base?: string; head?: string }) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSession(client, repoId, prNumber, span, io);
    },
  );
}

function registerMarksCommand(program: Command, context: CommandContext): void {
  program
    .command("marks")
    .description(
      "comparison marks (coordinates only) for a baseline..head span",
    )
    .argument("<number>", "PR number")
    .option("--baseline <sha>", "comparison baseline (required)")
    .option("--head <sha>", "comparison head (required)")
    .action(
      async (raw: string, options: { baseline?: string; head?: string }) => {
        const prNumber = parsePrNumber(raw);
        const span = requireComparisonSpan(options.baseline, options.head);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runMarks(client, repoId, prNumber, span, io);
      },
    );
}

function registerNarrativeCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("narrative")
    .description("the revision narrative for a prevHead..head hop")
    .argument("<number>", "PR number")
    .option("--prev-head <sha>", "prior briefed head (required)")
    .option("--head <sha>", "revision head (required)")
    .action(
      async (raw: string, options: { prevHead?: string; head?: string }) => {
        const prNumber = parsePrNumber(raw);
        const span = requireNarrativeSpan(options.prevHead, options.head);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runNarrative(client, repoId, prNumber, span, io);
      },
    );
}

function registerContextCommand(
  program: Command,
  context: CommandContext,
): void {
  const contextCommand = program
    .command("context")
    .description("the brief's repo-config snapshot for the span you name")
    .argument("<number>", "PR number");
  addSpanOptions(contextCommand).action(
    async (raw: string, options: { base?: string; head?: string }) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runContext(client, repoId, prNumber, span, io);
    },
  );
}

function registerDraftCommands(
  program: Command,
  context: CommandContext,
): void {
  const draft = program
    .command("draft")
    .description("draft review comments in your session (posted at submit)");

  registerDraftCreateCommand(draft, context);
  registerDraftUpdateCommand(draft, context);
  registerDraftReanchorCommand(draft, context);
  registerDraftDeleteCommand(draft, context);
  registerDraftAttachCommand(draft, context);
}

function registerDraftCreateCommand(
  draft: Command,
  context: CommandContext,
): void {
  const create = draft
    .command("create")
    .description("draft a new inline comment on the brief span you name")
    .argument("<number>", "PR number");
  addPayloadOption(create, FULL_PAYLOAD_DESCRIPTION);
  addAnchorOptions(create).option("--body <text>", "comment body (flag form)");
  addSpanOptions(create).action(
    async (
      raw: string,
      options: AnchorFlags & {
        payload?: string;
        body?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const input: Mutable<CreateDraftInput> = {
        file: options.file,
        side: options.side,
        startSide: options.startSide,
        start: options.start,
        end: options.end,
        body: options.body,
      };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildCreateDraftPayload(input);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.CREATE_DRAFT_COMMENT,
          params: { repoId, prNumber },
          span,
          payload,
        },
        io,
      );
    },
  );
}

function registerDraftUpdateCommand(
  draft: Command,
  context: CommandContext,
): void {
  const update = draft
    .command("update")
    .description("edit a held draft's body")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addPayloadOption(update, FULL_PAYLOAD_DESCRIPTION).option(
    "--body <text>",
    "new comment body (flag form)",
  );
  addSpanOptions(update).action(
    async (
      raw: string,
      draftId: string,
      options: {
        payload?: string;
        body?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const input: Mutable<UpdateDraftInput> = { body: options.body };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildUpdateDraftPayload(input);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.UPDATE_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
          payload,
        },
        io,
      );
    },
  );
}

function registerDraftReanchorCommand(
  draft: Command,
  context: CommandContext,
): void {
  const reanchor = draft
    .command("reanchor")
    .description("move a held draft's anchor (settles a carried orphan)")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addPayloadOption(reanchor, FULL_PAYLOAD_DESCRIPTION);
  addAnchorOptions(reanchor);
  addSpanOptions(reanchor).action(
    async (
      raw: string,
      draftId: string,
      options: AnchorFlags & {
        payload?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const input: Mutable<ReanchorInput> = {
        file: options.file,
        side: options.side,
        startSide: options.startSide,
        start: options.start,
        end: options.end,
      };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildReanchorPayload(input);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
          payload,
        },
        io,
      );
    },
  );
}

function registerDraftDeleteCommand(
  draft: Command,
  context: CommandContext,
): void {
  const remove = draft
    .command("delete")
    .description("delete a held draft")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addSpanOptions(remove).action(
    async (
      raw: string,
      draftId: string,
      options: { base?: string; head?: string },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.DELETE_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
        },
        io,
      );
    },
  );
}

function registerDraftAttachCommand(
  draft: Command,
  context: CommandContext,
): void {
  draft
    .command("attach")
    .description(
      "upload an image to the repository's attachments branch; prints {url}",
    )
    .argument("<number>", "PR number")
    .argument("<file>", "a png, jpg, gif or webp file")
    .option(
      "--draft <draftId>",
      "also append the image to this held draft (needs --base and --head)",
    )
    .option("--base <sha>", "span base of the brief (with --draft)")
    .option("--head <sha>", "span head of the brief (with --draft)")
    .action(
      async (
        raw: string,
        path: string,
        options: { draft?: string; base?: string; head?: string },
      ) => {
        const prNumber = parsePrNumber(raw);
        const file = readAttachmentFile(context.deps, path);
        let target: AttachDraftTarget | undefined;
        if (options.draft !== undefined) {
          target = {
            draftId: options.draft,
            span: requireSpan(options.base, options.head),
          };
        }

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runAttach(client, { repoId, prNumber, file, draft: target }, io);
      },
    );
}

function registerChunkReadCommand(
  program: Command,
  context: CommandContext,
): void {
  const chunkRead = program
    .command("chunk-read")
    .description("mark a brief chunk read (--unread clears the mark)")
    .argument("<number>", "PR number")
    .argument("<chunkId>", "the chunk id as the brief spells it")
    .option("--read", "mark read (the default)")
    .option("--unread", "clear the read mark");
  addSpanOptions(chunkRead).action(
    async (
      raw: string,
      chunkId: string,
      options: {
        read?: boolean;
        unread?: boolean;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const read = resolveReadFlag(options.read, options.unread);
      const id = read
        ? ProductActionIds.MARK_CHUNK_READ
        : ProductActionIds.MARK_CHUNK_UNREAD;

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        { id, params: { repoId, prNumber, chunkId }, span },
        io,
      );
    },
  );
}

interface RiskFlags {
  payload?: string;
  reason?: string;
  base?: string;
  head?: string;
}

function createRiskAction(
  context: CommandContext,
  id: RiskOperationId,
  takesReason: boolean,
): (raw: string, options: RiskFlags) => Promise<void> {
  return async (raw, options) => {
    const prNumber = parsePrNumber(raw);
    const span = requireSpan(options.base, options.head);
    let flagsPayload: unknown;
    if (options.payload !== undefined) {
      flagsPayload = await readPayload(context.deps, options.payload);
    }
    const payload = buildRiskPayload(
      flagsPayload,
      takesReason ? options.reason : undefined,
    );

    const { client, repoId, io } = await resolveRepoTarget(context);
    await runSessionOperation(
      client,
      { id, params: { repoId, prNumber }, span, payload },
      io,
    );
  };
}

function registerRiskCommands(program: Command, context: CommandContext): void {
  const risk = program
    .command("risk")
    .description("disposition the brief's risk flags in your session");

  const dismiss = risk
    .command("dismiss")
    .description("dismiss risk flags (the payload's flags array names them)")
    .argument("<number>", "PR number");
  addPayloadOption(dismiss, REQUIRED_PAYLOAD_DESCRIPTION).option(
    "--reason <text>",
    "dismissal reason (unless the payload carries one)",
  );
  addSpanOptions(dismiss).action(
    createRiskAction(context, ProductActionIds.DISMISS_RISK, true),
  );

  const address = risk
    .command("address")
    .description("mark risk flags addressed (each flag carries its evidence)")
    .argument("<number>", "PR number");
  addPayloadOption(address, REQUIRED_PAYLOAD_DESCRIPTION);
  addSpanOptions(address).action(
    createRiskAction(context, ProductActionIds.ADDRESS_RISK, false),
  );

  const reopen = risk
    .command("reopen")
    .description("undo dispositions on risk flags")
    .argument("<number>", "PR number");
  addPayloadOption(reopen, REQUIRED_PAYLOAD_DESCRIPTION);
  addSpanOptions(reopen).action(
    createRiskAction(context, ProductActionIds.REOPEN_RISK, false),
  );
}

function registerReclassifyCommand(
  program: Command,
  context: CommandContext,
): void {
  const reclassify = program
    .command("reclassify")
    .description("override a change group's category in your session")
    .argument("<number>", "PR number")
    .argument("<groupId>", "the change group id (see `groups <n>`)")
    .requiredOption("--category <category>", "the category to record");
  addSpanOptions(reclassify).action(
    async (
      raw: string,
      groupId: string,
      options: { category: string; base?: string; head?: string },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.RECLASSIFY_GROUP,
          params: { repoId, prNumber, groupId },
          span,
          payload: { category: options.category },
        },
        io,
      );
    },
  );
}

function registerOutcomeCommand(
  program: Command,
  context: CommandContext,
): void {
  const outcomeCommand = program
    .command("outcome")
    .description("set your session's review intent (publishing is `submit`)")
    .argument("<number>", "PR number")
    .argument("<outcome>", REVIEW_OUTCOME_CHOICES);
  addSpanOptions(outcomeCommand).action(
    async (
      raw: string,
      outcome: string,
      options: { base?: string; head?: string },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.SET_REVIEW_OUTCOME,
          params: { repoId, prNumber },
          span,
          payload: { outcome },
        },
        io,
      );
    },
  );
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
