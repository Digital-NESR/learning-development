-- "Open" and "Ongoing" are one status now, shown as "Ongoing" (stored as 'open', the value that accepts requests).
UPDATE "trainings" SET "status" = 'open' WHERE "status" = 'ongoing';
