import { summarizeLockfile } from "brief-core/shortened";
import { SummaryRequestSchema } from "./schemas";
import type { SummaryReply } from "./types";

// The body of one lockfile child process: read one request, post one reply,
// exit. A request that fails to parse throws, which the parent reads as a
// crash; a parent gone before the reply ends the child.
process.on("disconnect", () => {
  process.exit();
});
process.once("message", (message: unknown) => {
  const request = SummaryRequestSchema.parse(message);
  const reply: SummaryReply = {};
  const summary = summarizeLockfile(
    request.path,
    request.sides,
    request.mergeBases,
  );
  if (summary !== undefined) {
    reply.summary = summary;
  }
  process.send?.(reply, () => {
    process.exit();
  });
});
