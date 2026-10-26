-- Enrollment now happens on manager approval, not L&D confirmation.
UPDATE "notification_templates"
SET "trigger" = 'Manager approves and a seat is free', "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'enrolled' AND "trigger" = 'L&D confirms a seat';
