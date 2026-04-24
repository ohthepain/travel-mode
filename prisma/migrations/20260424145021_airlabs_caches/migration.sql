-- CreateTable
CREATE TABLE "airlabs_airport" (
    "iataCode" TEXT NOT NULL,
    "icaoCode" TEXT,
    "name" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airlabs_airport_pkey" PRIMARY KEY ("iataCode")
);

-- CreateTable
CREATE TABLE "airlabs_airline" (
    "iataCode" TEXT NOT NULL,
    "icaoCode" TEXT,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airlabs_airline_pkey" PRIMARY KEY ("iataCode")
);

-- CreateTable
CREATE TABLE "airlabs_city" (
    "cityCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airlabs_city_pkey" PRIMARY KEY ("cityCode")
);

-- CreateTable
CREATE TABLE "airlabs_schedule_cache" (
    "id" TEXT NOT NULL,
    "flightIata" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airlabs_schedule_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airlabs_schedule_cache_fetchedAt_idx" ON "airlabs_schedule_cache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "airlabs_schedule_cache_flightIata_dateKey_key" ON "airlabs_schedule_cache"("flightIata", "dateKey");
