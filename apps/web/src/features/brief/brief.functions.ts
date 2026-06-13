import { createServerFn } from "@tanstack/react-start";

import { readLocalBrief } from "./brief.server";

export const getLocalBrief = createServerFn({ method: "GET" }).handler(async () => readLocalBrief());
