-- Trainings are cancelled now, not deleted: update the template's "sent when" text.
UPDATE "notification_templates" SET "trigger" = 'L&D cancels a training' WHERE "id" = 'cancelled' AND "trigger" = 'L&D deletes a training';
