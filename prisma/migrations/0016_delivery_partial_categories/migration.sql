-- Training calendar "Delivery Method": online sessions are Online, the rest In-Person (L&D can change it).
ALTER TABLE "trainings" ADD COLUMN "delivery_method" TEXT;
UPDATE "trainings" SET "delivery_method" = CASE WHEN "location" ILIKE '%online%' THEN 'Online' ELSE 'In-Person' END;

-- "Partially Attended" overall attendance.
ALTER TABLE "attendance" ADD COLUMN "partial" BOOLEAN NOT NULL DEFAULT false;

-- Instructor profiles can be filtered by the training categories they deliver.
ALTER TABLE "instructor_profiles" ADD COLUMN "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
