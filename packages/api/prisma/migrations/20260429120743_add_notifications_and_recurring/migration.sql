-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('bill_submitted', 'bill_approved', 'bill_rejected', 'bill_paid');

-- CreateEnum
CREATE TYPE "RecurringCadence" AS ENUM ('monthly', 'quarterly', 'yearly');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "bill_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_bill_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "cadence" "RecurringCadence" NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "paused_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_bill_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications"("recipient_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "recurring_templates_due_idx" ON "recurring_bill_templates"("next_run_at", "is_active");

-- CreateIndex
CREATE INDEX "recurring_templates_creator_idx" ON "recurring_bill_templates"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bill_templates" ADD CONSTRAINT "recurring_bill_templates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bill_templates" ADD CONSTRAINT "recurring_bill_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
