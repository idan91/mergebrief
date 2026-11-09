ALTER TABLE "brief" ADD COLUMN "anchor_state" text;--> statement-breakpoint
ALTER TABLE "brief" ADD COLUMN "anchor_reason" text;--> statement-breakpoint

-- Anchor provenance vocabulary, DB-enforced like migration 0002's
-- closed vocabs (keep in lockstep with `AnchorStates`/`FreshRestartReasons`
-- in packages/generators/src/contract/provenance.ts). NULL = a row predating
-- the stamp. (Drizzle migrations are forward-only — no down step; rollback is
-- DROP CONSTRAINT for each name below, then DROP COLUMN.)
ALTER TABLE "brief"
ADD CONSTRAINT "brief_anchor_state_check"
CHECK ("anchor_state" IS NULL OR "anchor_state" IN ('anchored', 'fresh-restart', 'none'));--> statement-breakpoint

-- Shape: a reason exists exactly on a fresh restart, and comes from the
-- closed reason vocabulary.
ALTER TABLE "brief"
ADD CONSTRAINT "brief_anchor_reason_shape"
CHECK (
  ("anchor_state" = 'fresh-restart' AND "anchor_reason" IN ('model-swap'))
  OR ("anchor_state" IS DISTINCT FROM 'fresh-restart' AND "anchor_reason" IS NULL)
);
