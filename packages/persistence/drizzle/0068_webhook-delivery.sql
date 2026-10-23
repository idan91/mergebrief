CREATE TABLE "webhook_delivery" (
	"signature_digest" text PRIMARY KEY NOT NULL,
	"delivery_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_signature_digest_shape" CHECK ("webhook_delivery"."signature_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "webhook_delivery_delivery_id_shape" CHECK ("webhook_delivery"."delivery_id" is null or "webhook_delivery"."delivery_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE INDEX "webhook_delivery_received_at_idx" ON "webhook_delivery" USING btree ("received_at");