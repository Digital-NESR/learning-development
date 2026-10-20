-- The portal is now called "Training Portal". Update stored email templates that mention the old name.
UPDATE "notification_templates"
SET "subject" = REPLACE("subject", 'L&D Portal', 'Training Portal'),
    "body"    = REPLACE("body", 'L&D Portal', 'Training Portal'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "subject" LIKE '%L&D Portal%' OR "body" LIKE '%L&D Portal%';
