-- Four training statuses: Registration Open, Registration Closed, Completed, Cancelled.
-- "Class Full" becomes "Registration Closed" (a full class is still detected from the seat count).
UPDATE "trainings" SET "status" = 'registration_closed' WHERE "status" = 'class_full';
UPDATE "trainings" SET "status" = 'open' WHERE "status" = 'ongoing';
