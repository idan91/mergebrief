import "@tanstack/react-start/server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Brief } from "./types";
import { parseBrief } from "./validation";

const LOCAL_BRIEF_PATH = resolve(process.cwd(), "../../tools/categorizer/out/Idan91-flexer-55.brief.json");

export async function readLocalBrief(): Promise<Brief> {
  const raw = await readFile(LOCAL_BRIEF_PATH, "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  const parsedBrief = parseBrief(parsedJson);
  if (!parsedBrief.ok) {
    throw new Error(`Invalid local brief: ${parsedBrief.error}`);
  }
  return parsedBrief.value;
}
