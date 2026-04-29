/**
 * Maps airport IATA → IATA **city** / metropolitan area codes for major multi-airport cities.
 * When missing, callers default to treating the airport IATA code as its own city code.
 * Edit this map or `/data/air-to-city-code.json` overrides (merged on load) to tune coverage.
 */
export const AIRPORT_TO_IATA_CITY_CODE: Readonly<Record<string, string>> = {
  // Stockholm
  ARN: 'STO',
  BMA: 'STO',
  NYO: 'STO',

  // London
  LHR: 'LON',
  LGW: 'LON',
  STN: 'LON',
  LCY: 'LON',
  LTN: 'LON',
  SEN: 'LON',

  // New York metro
  JFK: 'NYC',
  LGA: 'NYC',
  EWR: 'NYC',

  // Chicago
  ORD: 'CHI',
  MDW: 'CHI',

  // Paris
  CDG: 'PAR',
  ORY: 'PAR',
  BVA: 'PAR',

  // Los Angeles basin
  LAX: 'LAX',
  BUR: 'LAX',
  LGB: 'LAX',
  ONT: 'LAX',
  SNA: 'LAX',

  // San Francisco Bay
  SFO: 'SFO',
  OAK: 'SFO',
  SJC: 'SFO',

  // Miami–Fort Lauderdale–West Palm Beach
  MIA: 'MIA',
  FLL: 'MIA',
  PBI: 'MIA',

  // Tokyo
  NRT: 'TYO',
  HND: 'TYO',

  // Seoul
  ICN: 'SEL',
  GMP: 'SEL',

  // Berlin (+ historic Schönefeld migrated to Brandenburg)
  SXF: 'BER',

  // Washington DC/Baltimore
  IAD: 'WAS',
  DCA: 'WAS',
  BWI: 'WAS',

  // Milan
  MXP: 'MIL',
  LIN: 'MIL',
  BGY: 'MIL',

  // Rome
  FCO: 'ROM',
  CIA: 'ROM',

  // Osaka
  KIX: 'OSA',
  ITM: 'OSA',

  // Shanghai
  PVG: 'SHA',
  SHA: 'SHA',

  // Beijing
  PEK: 'BJS',
  PKX: 'BJS',

  // Houston
  IAH: 'HOU',
  HOU: 'HOU',

  // Dallas/Fort Worth
  DFW: 'DFW',
  DAL: 'DFW',

  // Toronto metro
  YYZ: 'YTO',
  YTZ: 'YTO',
  YKF: 'YTO',
}

export function metroCityCodeOrAirportDefault(airportIata: string): string {
  const u = airportIata.trim().toUpperCase()
  return AIRPORT_TO_IATA_CITY_CODE[u] ?? u
}
