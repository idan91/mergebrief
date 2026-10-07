import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CursorGenerator } from "../src/adapters/cursor";
import {
  describeGeneratorContract,
  type ContractGeneratorHandle,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * The shared Generator conformance suite against REAL fake-cursor processes
 * (fake the binary, never the spawn): each floor attempt spawns a fresh shim
 * whose scripted turn comes from turns.json; stdin/argv per attempt are
 * recorded for the feedback assertions.
 */

const FAKE_CURSOR = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-cursor.cjs",
);

function makeCursorHarness(): GeneratorContractHarness {
  let abortReason: Error | null = null;
  let scriptDir = "";

  return {
    // No model configured: the CLI's own default runs, so the stamp is the
    // sentinel and effort has no bracket to ride (capabilities note §3).
    expectedOrigin: {
      provider: "cursor",
      model: "cursor-default",
      effort: null,
    },
    // cursor has no distinct refusal signal; refusals arrive as ordinary
    // result text and fall to the schema floor.
    supportsRefusal: false,
    isAbortRejection: (error) => abortReason !== null && error === abortReason,
    make(turns: readonly ContractTurn[], failureDir: string) {
      // Inside failureDir: the contract suite's afterEach removes it, so
      // script fixtures never accumulate across runs. dumps() only counts
      // *.failed.json entries, so the extra directory is invisible to it.
      scriptDir = mkdtempSync(join(failureDir, "script-"));
      const scripted = turns.map((turn) => {
        if ("abort" in turn) {
          return { hang: true };
        }
        if ("refusal" in turn) {
          throw new Error("cursor has no refusal turn");
        }
        return { output: turn.raw };
      });
      writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(scripted));

      const controller = new AbortController();
      const wantsAbort = turns.some((turn) => "abort" in turn);
      if (wantsAbort) {
        abortReason = new Error("contract abort");
        // Abort only after the shim demonstrably STARTED (it writes the
        // counter file first thing). A fixed delay could abort before the
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

      const generator = new CursorGenerator({
        command: FAKE_CURSOR,
        failureDir,
        env: {
          ...process.env,
          SHIM_SCENARIO: "scripted",
          SHIM_SCRIPT_DIR: scriptDir,
        },
        // Scaled-real timers: irrelevant for scripted turns (fast exits),
        // small enough that a scripting bug fails the test, not the suite.
        timeouts: { hardMs: 8000, killGraceMs: 300 },
      });

      const handle: ContractGeneratorHandle = {
        generator,
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
      if (wantsAbort) {
        handle.signal = controller.signal;
      }
      return handle;
    },
  };
}

describeGeneratorContract("cursor (fake-cursor shim)", makeCursorHarness);
