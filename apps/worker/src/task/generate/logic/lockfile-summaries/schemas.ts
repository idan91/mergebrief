import { z } from "zod/v4";
import {
  LockfileFormats,
  LockfileReadFailures,
  LockfileSideKinds,
  type LockfileSummary,
} from "brief-core/shortened";
import type { SummaryReply, SummaryRequest } from "./types";

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

const LockfileSummarySchema: z.ZodType<LockfileSummary> = z.union([
  z.object({
    format: PackageFormatSchema,
    changes: z.object({
      added: z.array(PackageVersionSchema),
      removed: z.array(PackageVersionSchema),
      updated: z.array(PackageUpdateSchema),
      sourceChanged: z.array(PackageSourceChangeSchema),
    }),
    baseHosts: HostsSchema,
  }),
  z.object({
    format: PackageFormatSchema,
    unread: z.enum(LockfileReadFailures),
  }),
  z.object({ format: z.literal(LockfileFormats.OTHER) }),
]);

export const SummaryReplySchema: z.ZodType<SummaryReply> = z.object({
  summary: LockfileSummarySchema.exactOptional(),
});
