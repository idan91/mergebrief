import { z } from "zod/v4";
import {
  LockfileFormats,
  LockfileReadFailures,
  LockfileSideKinds,
  type LockfileSummary,
} from "brief-core/shortened";
import type { Equals } from "types/utils";
import type { SummaryReply, SummaryRequest } from "./types";

type PackageSummary = Extract<LockfileSummary, { changes: unknown }>;
type PackageChanges = PackageSummary["changes"];
type UnreadSummary = Extract<LockfileSummary, { unread: unknown }>;

const LockfileSideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(LockfileSideKinds.TEXT), text: z.string() }),
  z.object({ kind: z.literal(LockfileSideKinds.ABSENT) }),
  z.object({ kind: z.literal(LockfileSideKinds.UNAVAILABLE) }),
]);

export const SummaryRequestSchema: z.ZodType<SummaryRequest> = z.object({
  path: z.string(),
  sides: z.object({ before: LockfileSideSchema, after: LockfileSideSchema }),
});

const HostsSchema = z.array(z.string()).exactOptional();
const AliasSchema = z.string().exactOptional();

const PackageVersionSchema = z.object({
  name: z.string(),
  version: z.string(),
  hosts: HostsSchema,
  aliasOf: AliasSchema,
});

const PackageUpdateSchema = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
  fromHosts: HostsSchema,
  toHosts: HostsSchema,
  fromAliasOf: AliasSchema,
  toAliasOf: AliasSchema,
});

const PackageSourceChangeSchema = z.object({
  name: z.string(),
  version: z.string(),
  fromHosts: HostsSchema,
  toHosts: HostsSchema,
  fromAliasOf: AliasSchema,
  toAliasOf: AliasSchema,
});

const PackageFormatSchema = z.enum([
  LockfileFormats.PNPM,
  LockfileFormats.NPM,
  LockfileFormats.YARN,
]);

const PackageChangesSchema = z.object({
  added: z.array(PackageVersionSchema),
  removed: z.array(PackageVersionSchema),
  updated: z.array(PackageUpdateSchema),
  sourceChanged: z.array(PackageSourceChangeSchema),
});

const PackageSummarySchema = z.object({
  format: PackageFormatSchema,
  changes: PackageChangesSchema,
  baseHosts: HostsSchema,
});

const UnreadSummarySchema = z.object({
  format: PackageFormatSchema,
  unread: z.enum(LockfileReadFailures),
});

// z.object strips a key it does not list, so each mirror is pinned to the
// summary shape it carries: a field brief-core adds fails the typecheck here.
true satisfies Equals<
  z.infer<typeof PackageVersionSchema>,
  PackageChanges["added"][number]
>;
true satisfies Equals<
  z.infer<typeof PackageUpdateSchema>,
  PackageChanges["updated"][number]
>;
true satisfies Equals<
  z.infer<typeof PackageSourceChangeSchema>,
  PackageChanges["sourceChanged"][number]
>;
true satisfies Equals<z.infer<typeof PackageChangesSchema>, PackageChanges>;
true satisfies Equals<z.infer<typeof PackageSummarySchema>, PackageSummary>;
true satisfies Equals<z.infer<typeof UnreadSummarySchema>, UnreadSummary>;

const LockfileSummarySchema: z.ZodType<LockfileSummary> = z.union([
  PackageSummarySchema,
  UnreadSummarySchema,
  z.object({ format: z.literal(LockfileFormats.OTHER) }),
]);

export const SummaryReplySchema: z.ZodType<SummaryReply> = z.object({
  summary: LockfileSummarySchema.exactOptional(),
});
