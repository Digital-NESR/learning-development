-- Training outlines under Resources: an uploaded document and/or a link.
CREATE TABLE "training_outlines" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "link" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "file_data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "training_outlines_pkey" PRIMARY KEY ("id")
);
