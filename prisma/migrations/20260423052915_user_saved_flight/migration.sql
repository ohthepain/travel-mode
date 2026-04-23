-- CreateTable
CREATE TABLE "user_saved_flight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "fr24FlightId" TEXT,
    "originIata" TEXT,
    "destIata" TEXT,
    "scheduledDeparture" TIMESTAMP(3),
    "scheduledArrival" TIMESTAMP(3),
    "takeoffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_flight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_saved_flight_userId_idx" ON "user_saved_flight"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_saved_flight_userId_flightNumber_travelDate_key" ON "user_saved_flight"("userId", "flightNumber", "travelDate");

-- AddForeignKey
ALTER TABLE "user_saved_flight" ADD CONSTRAINT "user_saved_flight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
