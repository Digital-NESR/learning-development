-- Completed trainings from before the portal (imported by L&D from the consolidated Excel file).
CREATE TABLE "training_history" (
    "id" TEXT NOT NULL,
    "nesr_id" TEXT,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "training_history_nesr_id_idx" ON "training_history"("nesr_id");
CREATE INDEX "training_history_name_key_idx" ON "training_history"("name_key");

-- "Declined" is now "Rejected" throughout the portal.
UPDATE "notification_templates" SET "trigger" = 'Manager or L&D rejects' WHERE "id" = 'declined' AND "trigger" = 'Manager or L&D declines';
UPDATE "notification_templates" SET "trigger" = 'A manager approves or rejects a request (sent to the L&D team)'
  WHERE "id" = 'ld_decision' AND "trigger" = 'A manager approves or declines a request (sent to the L&D team)';
UPDATE "notification_templates" SET "body" = REPLACE("body", 'approve or decline', 'approve or reject') WHERE "id" = 'manager';
