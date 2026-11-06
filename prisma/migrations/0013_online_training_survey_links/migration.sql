-- "Virtual Classroom" is now called "Online Training".
UPDATE "trainings" SET "location" = 'Online Training' WHERE "location" = 'Virtual Classroom';
UPDATE "employees" SET "location" = 'Online Training' WHERE "location" = 'Virtual Classroom';

-- Attendance is marked by L&D from the signed sheet (no QR check-in). Remember which overall
-- results came from the day marks, so changing a day only undoes those, never L&D's own choice.
ALTER TABLE "attendance" ADD COLUMN "from_days" BOOLEAN NOT NULL DEFAULT false;

-- Feedback surveys are emailed as a link (no QR code): track who was sent it and reminded.
ALTER TABLE "training_requests" ADD COLUMN "survey_sent_at" TIMESTAMP(3);
ALTER TABLE "training_requests" ADD COLUMN "survey_reminded_at" TIMESTAMP(3);
ALTER TABLE "training_requests" ADD COLUMN "survey_reminders" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body", "updated_at") VALUES
  ('survey', 'Feedback Survey', 'The day after a training ends (or when L&D sends it)',
   'Your feedback on {{training_title}}',
   'Thank you for attending {{session_code}} — {{training_title}} ({{dates}}). Please take a few minutes to complete the feedback survey. It helps us improve future training.

{{survey_link}}',
   CURRENT_TIMESTAMP),
  ('survey_reminder', 'Feedback Survey Reminder', 'The survey has not been completed yet',
   'Reminder: your feedback on {{training_title}}',
   'We haven''t received your feedback on {{session_code}} — {{training_title}} ({{dates}}) yet. It only takes a few minutes.

{{survey_link}}',
   CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
