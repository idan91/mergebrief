import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeGenerator } from "../src/adapters/claudeCode";
import {
  describeGeneratorContract,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * The shared Generator conformance suite against REAL fake-claude processes
 * (fake the binary, never the spawn): each floor attempt spawns a fresh shim
 * whose scripted turn comes from turns.json; stdin/argv per attempt are
 * recorded for the feedback assertions.
 */

const FAKE_CLAUDE = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-claude.cjs",
);

function makeClaudeCodeHarness(): GeneratorContractHarness {
  let abortReason: Error | null = null;
  let scriptDir = "";

  return {
    expectedProvenance: {
      provider: "claude-code",
      model: "claude-opus-4-8",
      effort: null,
    },
    // The claude CLI has no distinct refusal signal (capabilities note §1) —
    // refusals arrive as ordinary text and fall to the schema floor.
    supportsRefusal: false,
    isAbortRejection: (error) => abortReason !== null && error === abortReason,
    make(turns: readonly ContractTurn[], failureDir: string) {
      // Inside failureDir: the contract suite's afterEach removes it, so
      // script fixtures never accumulate across runs. dumps() only counts
      // *.failed.json entries, so the extra directory is invisible to it.
      scriptDir = mkdtempSync(join(failureDir, "script-"));
      const scripted = turns.map((turn) => {
        if ("abort" in turn) return { hang: true };
        if ("refusal" in turn)
          throw new Error("claude-code has no refusal turn");
        return { output: turn.raw };
      });
      writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(scripted));

      const controller = new AbortController();
      const wantsAbort = turns.some((turn) => "abort" in turn);
      if (wantsAbort) {
        abortReason = new Error("contract abort");
        // Abort only after the shim demonstrably STARTED (it writes the
        // counter file first thing) — a fixed delay could abort before the
        // spawn under CI load and break the one-attempt assertion. The
        // fail-safe keeps a scripting bug from hanging the test.
        const counter = join(scriptDir, "counter");
        const started = Date.now();
        const poll = setInterval(() => {
          if (existsSync(counter) || Date.now() - started > 3000) {
            clearInterval(poll);
            controller.abort(abortReason);
          }
        }, 20);
      }

      const generator = new ClaudeCodeGenerator({
        command: FAKE_CLAUDE,
        failureDir,
        env: {
          ...process.env,
          SHIM_SCENARIO: "scripted",
          SHIM_SCRIPT_DIR: scriptDir,
        },
        // Scaled-real timers: irrelevant for scripted turns (fast exits),
        // small enough that a scripting bug fails the test, not the suite.
        timeouts: { hardMs: 8000, inactivityMs: 4000, killGraceMs: 300 },
      });

      return {
        generator,
        ...(wantsAbort ? { signal: controller.signal } : {}),
        attempts: () => {
          const counter = join(scriptDir, "counter");
          return existsSync(counter)
            ? Number(readFileSync(counter, "utf8"))
            : 0;
        },
        feedbackSeen: () => {
          const stdin = join(scriptDir, "stdin-1.txt");
          return existsSync(stdin) ? readFileSync(stdin, "utf8") : null;
        },
      };
    },
  };
}

describeGeneratorContract(
  "claude-code (fake-claude shim)",
  makeClaudeCodeHarness,
);
