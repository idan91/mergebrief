import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexGenerator } from "../src/adapters/codex";
import {
  describeGeneratorContract,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * The shared Generator conformance suite against REAL fake-codex processes:
 * each floor attempt spawns a fresh shim whose scripted turn comes from
 * turns.json; stdin/argv/schema per attempt are recorded.
 */

const FAKE_CODEX = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-codex.cjs",
);

function makeCodexHarness(): GeneratorContractHarness {
  let abortReason: Error | null = null;
  let scriptDir = "";

  return {
    expectedProvenance: {
      provider: "codex",
      model: "codex-default",
      effort: "medium",
    },
    // turn.failed / error events carry undiscriminated message strings —
    // there is no refusal signal to classify (capabilities note §2).
    supportsRefusal: false,
    isAbortRejection: (error) => abortReason !== null && error === abortReason,
    make(turns: readonly ContractTurn[], failureDir: string) {
      // Inside failureDir: the contract suite's afterEach removes it.
      scriptDir = mkdtempSync(join(failureDir, "script-"));
      const scripted = turns.map((turn) => {
        if ("abort" in turn) return { hang: true };
        if ("refusal" in turn) throw new Error("codex has no refusal turn");
        return { output: turn.raw };
      });
      writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(scripted));

      const controller = new AbortController();
      const wantsAbort = turns.some((turn) => "abort" in turn);
      if (wantsAbort) {
        abortReason = new Error("contract abort");
        // Abort only once the shim demonstrably started (counter exists).
        const counter = join(scriptDir, "counter");
        const started = Date.now();
        const poll = setInterval(() => {
          if (existsSync(counter) || Date.now() - started > 3000) {
            clearInterval(poll);
            controller.abort(abortReason);
          }
        }, 20);
      }

      const generator = new CodexGenerator({
        command: FAKE_CODEX,
        failureDir,
        env: {
          ...process.env,
          SHIM_SCENARIO: "scripted",
          SHIM_SCRIPT_DIR: scriptDir,
        },
        timeouts: { hardMs: 8000, inactivityMs: 4000, killGraceMs: 300 },
      });

      return {
        generator,
        ...(wantsAbort ? { signal: controller.signal } : {}),
        attempts: () => {
          const counter = join(scriptDir, "counter");
          return existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
        },
        feedbackSeen: () => {
          const stdin = join(scriptDir, "stdin-1.txt");
          return existsSync(stdin) ? readFileSync(stdin, "utf8") : null;
        },
      };
    },
  };
}

describeGeneratorContract("codex (fake-codex shim)", makeCodexHarness);
