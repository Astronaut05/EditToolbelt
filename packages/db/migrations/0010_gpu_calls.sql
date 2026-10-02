ALTER TABLE "jobs" ADD COLUMN "gpu_call_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gpu_call_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gpu_output_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gpu_put_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_gpu_spend_idx" ON "jobs" USING btree ("started_at") WHERE "jobs"."gpu_rate_usd" is not null;--> statement-breakpoint
CREATE INDEX "jobs_gpu_call_idx" ON "jobs" USING btree ("gpu_call_at") WHERE "jobs"."gpu_call_at" is not null;--> statement-breakpoint
CREATE INDEX "jobs_gpu_keys_idx" ON "jobs" USING btree ("gpu_put_expires_at") WHERE "jobs"."gpu_put_expires_at" is not null;