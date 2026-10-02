CREATE TABLE "gpu_budget" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_usd" numeric DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gpu_budget_one_row" CHECK ("gpu_budget"."id" = 1),
	CONSTRAINT "gpu_budget_not_negative" CHECK ("gpu_budget"."daily_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gpu_rate_usd" numeric;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gpu_cost_usd" numeric;--> statement-breakpoint
ALTER TABLE "tool_stats_daily" ADD COLUMN "gpu_cost_usd" numeric DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gpu_budget" ADD CONSTRAINT "gpu_budget_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The one budget row, at the default ($1 a day) until an admin changes it.
INSERT INTO "gpu_budget" ("id") VALUES (1) ON CONFLICT DO NOTHING;
