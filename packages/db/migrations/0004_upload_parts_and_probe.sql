ALTER TABLE "uploads" ADD COLUMN "multipart_id" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "part_size" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "part_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "probe" jsonb;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "probed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "probe_error" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "uploads_to_probe_idx" ON "uploads" USING btree ("completed_at") WHERE "uploads"."probed_at" is null and "uploads"."deleted_at" is null and "uploads"."completed_at" is not null;