-- "Enrolled" is now "Registered" in the portal. Only touch the template if L&D hasn't edited it.
UPDATE "notification_templates" SET "name" = 'Registration Confirmed' WHERE "id" = 'enrolled' AND "name" = 'Enrollment Confirmed';
UPDATE "notification_templates" SET "subject" = 'You are registered: {{training_title}}' WHERE "id" = 'enrolled' AND "subject" = 'You are enrolled: {{training_title}}';
