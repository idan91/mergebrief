import type { Command } from "commander";
import type { Mutable } from "types";
import { CliError, ExitCodes } from "../../exit";
import type { CommandContext } from "../../types";
import { readBodySource, readPayload } from "../inputs";
import {
  addPayloadExample,
  addPayloadOption,
  FULL_PAYLOAD_DESCRIPTION,
  REVIEW_OUTCOME_CHOICES,
} from "../options";
import { SUBMIT_REVIEW_EXAMPLE } from "../payload-examples";
import { parseSpanFlags, runSubmitWrite } from "../span";
import {
  isPrNumberArgument,
  parsePrNumber,
  resolveProfileTarget,
  resolveRepoTarget,
} from "../target";
import {
  buildSubmitPayload,
  runGenerate,
  runReady,
  runRegenerate,
  runReply,
  runSubmit,
  runThreadResolution,
  type SubmitInput,
} from "./run";

export function registerReplyCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("reply")
    .description("reply to a review comment (the viewer's own voice)")
    .argument("<commentId>", "the review comment id (see `conversation <n>`)")
    .requiredOption("--pr <number>", "the PR the comment belongs to")
    .option("--body <text>", "reply text")
    .option("--body-file <path>", 'reply text from a file, or "-" for stdin')
    .action(
      async (
        commentId: string,
        options: { pr: string; body?: string; bodyFile?: string },
      ) => {
        const body = await readBodySource(
          context.deps,
          options.body,
          options.bodyFile,
        );
        const prNumber = parsePrNumber(options.pr);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runReply(client, repoId, commentId, { pr: prNumber, body }, io);
      },
    );
}

export function registerSubmitCommand(
  program: Command,
  context: CommandContext,
): void {
  const submit = program
    .command("submit")
    .description(
      "submit a review of the brief you are on (its saved drafts go with it)",
    )
    .argument("<number>", "PR number");
  addPayloadOption(submit, FULL_PAYLOAD_DESCRIPTION);
  addPayloadExample(submit, SUBMIT_REVIEW_EXAMPLE);
  submit
    .option("--file <path>", "the same as --payload")
    .option("--outcome <outcome>", `${REVIEW_OUTCOME_CHOICES} (flag form)`)
    .option("--body <text>", "review body (flag form)")
    .option("--revision <n>", "the brief revision you reviewed")
    .option("--base <sha>", "span base of the brief you reviewed")
    .option("--head <sha>", "span head of the brief you reviewed")
    .action(
      async (
        raw: string,
        options: {
          payload?: string;
          file?: string;
          outcome?: string;
          body?: string;
          revision?: string;
          base?: string;
          head?: string;
        },
      ) => {
        if (options.payload !== undefined && options.file !== undefined) {
          throw new CliError(
            ExitCodes.USAGE,
            "--payload and --file name the same input: pass one",
          );
        }
        const input: Mutable<SubmitInput> = {
          outcome: options.outcome,
          body: options.body,
        };

        const payloadPath = options.payload ?? options.file;
        if (payloadPath !== undefined) {
          input.payload = await readPayload(context.deps, payloadPath);
        }

        // Usage validation BEFORE any network work: a malformed PR number or
        // a bad span flag must exit 2 even when target resolution would fail
        // with exit 4.
        const prNumber = parsePrNumber(raw);
        const selection = parseSpanFlags(options);
        const payload = buildSubmitPayload(input);

        const target = await resolveRepoTarget(context);
        const { client, repoId, io } = target;
        await runSubmitWrite(target, prNumber, selection, (span) =>
          runSubmit(client, repoId, prNumber, span, payload, io),
        );
      },
    );
}

function createThreadAction(
  context: CommandContext,
  resolved: boolean,
): (raw: string, commentId: string) => Promise<void> {
  return async (raw, commentId) => {
    const prNumber = parsePrNumber(raw);
    const { client, repoId, io } = await resolveRepoTarget(context);
    await runThreadResolution(
      client,
      repoId,
      prNumber,
      commentId,
      resolved,
      io,
    );
  };
}

export function registerThreadCommands(
  program: Command,
  context: CommandContext,
): void {
  const thread = program
    .command("thread")
    .description("review-thread state on GitHub (the viewer's own act)");
  thread
    .command("resolve")
    .description("resolve the thread rooted at a review comment")
    .argument("<number>", "PR number")
    .argument("<commentId>", "the thread's root review comment id")
    .action(createThreadAction(context, true));
  thread
    .command("unresolve")
    .description("reopen the thread rooted at a review comment")
    .argument("<number>", "PR number")
    .argument("<commentId>", "the thread's root review comment id")
    .action(createThreadAction(context, false));
}

export function registerReadyCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("ready")
    .description(
      "mark a draft PR ready for review (GitHub-enforced authorship)",
    )
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const prNumber = parsePrNumber(raw);
      const { client, repoId } = await resolveRepoTarget(context);
      await runReady(client, repoId, prNumber);
    });
}

export function registerGenerateCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("generate")
    .description(
      "generate a PR's brief now: a number presses Generate on a held or failed head, a URL pastes it (no confirm; your own key)",
    )
    .argument(
      "<number|url>",
      "a PR number in the target repository, or a PR's GitHub URL",
    )
    .action(async (target: string) => {
      if (isPrNumberArgument(target)) {
        const { client, repoId } = await resolveRepoTarget(context);
        await runRegenerate(client, repoId, parsePrNumber(target));
        return;
      }
      const { client, io } = resolveProfileTarget(context);
      await runGenerate(client, target, io);
    });
}
