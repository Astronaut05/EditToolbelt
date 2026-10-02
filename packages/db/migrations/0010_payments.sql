ALTER TYPE "public"."purchase_status" ADD VALUE 'cancelled' BEFORE 'refunded';--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_provider_txn_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_credit_balance_nonnegative";--> statement-breakpoint
ALTER TABLE "credit_transactions" DROP CONSTRAINT "credit_transactions_balance_after_nonnegative";--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "provider_txn_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_purchase_once" ON "credit_transactions" USING btree ("purchase_id") WHERE "credit_transactions"."kind" = 'purchase';--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_refund_once" ON "credit_transactions" USING btree ("purchase_id","reason") WHERE "credit_transactions"."kind" = 'refund_purchase';--> statement-breakpoint
CREATE INDEX "purchases_provider_created_idx" ON "purchases" USING btree ("provider","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_provider_txn_key" ON "purchases" USING btree ("provider","provider_txn_id");--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_balance_after" CHECK ("credit_transactions"."balance_after" >= 0 or "credit_transactions"."amount" >= 0 or "credit_transactions"."kind" = 'refund_purchase');--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_purchase_ref" CHECK ("credit_transactions"."kind" not in ('purchase', 'refund_purchase') or "credit_transactions"."purchase_id" is not null);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_positive" CHECK ("purchases"."credits" > 0 and "purchases"."amount_minor" > 0);