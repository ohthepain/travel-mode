-- AlterTable
ALTER TABLE "track" ADD COLUMN     "destIata" TEXT,
ADD COLUMN     "destIcao" TEXT,
ADD COLUMN     "flightTimeSec" INTEGER,
ADD COLUMN     "landedAt" TIMESTAMP(3),
ADD COLUMN     "originIata" TEXT,
ADD COLUMN     "originIcao" TEXT,
ADD COLUMN     "scheduleJson" JSONB,
ADD COLUMN     "scheduledArrival" TIMESTAMP(3),
ADD COLUMN     "scheduledDeparture" TIMESTAMP(3),
ADD COLUMN     "takeoffAt" TIMESTAMP(3);
