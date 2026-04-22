-- AlterTable
ALTER TABLE "track" ALTER COLUMN "firstTimestampMs" SET DATA TYPE BIGINT USING "firstTimestampMs"::bigint;

-- AlterTable
ALTER TABLE "track" ALTER COLUMN "lastTimestampMs" SET DATA TYPE BIGINT USING "lastTimestampMs"::bigint;
