import "node:process";
import "process";

export const home = process.env["HOME"];
export const shell = process.env.SHELL;
export const path = process["env"];
export const viaGlobal = globalThis.process.env["HOME"];
const { env } = process;
const { env: aliased } = globalThis.process;
const { env: bracketed } = globalThis["process"];
export const viaBracket = globalThis["process"].env["HOME"];
export const both = [env, aliased, bracketed, viaBracket];
