-- Training status (replaces the open/closed flag), extra training fields,
-- external participants, and approval-reminder tracking.

CREATE TYPE "TrainingStatus" AS ENUM ('open', 'ongoing', 'completed', 'class_full', 'registration_closed', 'cancelled');

ALTER TABLE "trainings" ADD COLUMN "status" "TrainingStatus" NOT NULL DEFAULT 'open';
UPDATE "trainings" SET "status" = 'registration_closed' WHERE "registration_open" = false;
ALTER TABLE "trainings" DROP COLUMN "registration_open";
ALTER TABLE "trainings" ADD COLUMN "target_audience" TEXT;
ALTER TABLE "trainings" ADD COLUMN "provider" TEXT;
ALTER TABLE "trainings" ADD COLUMN "instructor_location" TEXT;

ALTER TABLE "employees" ADD COLUMN "is_external" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employees" ADD COLUMN "organization" TEXT;

ALTER TABLE "training_requests" ADD COLUMN "last_reminded_at" TIMESTAMP(3);

-- Reminder template for managers with pending approvals.
INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body", "updated_at") VALUES
  ('reminder', 'Approval Reminder', 'A request has waited for the manager''s decision',
   'Reminder: training approval pending for {{employee_name}}',
   '{{employee_name}} is still waiting for your decision on {{session_code}} — {{training_title}} ({{dates}}, {{location}}). Please approve or reject it in the Training Portal.',
   CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
