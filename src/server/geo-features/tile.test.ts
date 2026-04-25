import { describe, expect, it } from 'vitest'
import { degreeTileForLonLat, parseDegreeTilePrefix } from './tile'

describe('degree geo feature tiles', () => {
  it('formats northern/eastern tile prefixes', () => {
    expect(degreeTileForLonLat(18.06, 59.33)).toMatchObject({
      latTile: 59,
      lonTile: 18,
      tileId: '59_18',
      prefix: 'N59/E18',
      bbox: [18, 59, 19, 60],
    })
  })

  it('floors negative coordinates into the containing degree cell', () => {
    expect(degreeTileForLonLat(-58.38, -34.6)).toMatchObject({
      latTile: -35,
      lonTile: -59,
      tileId: '-35_-59',
      prefix: 'S35/W59',
      bbox: [-59, -35, -58, -34],
    })
  })

  it('clamps exact world edges into valid tile floors', () => {
    expect(degreeTileForLonLat(180, 90)).toMatchObject({
      latTile: 89,
      lonTile: 179,
      prefix: 'N89/E179',
    })
  })

  it('parses an S3 tile prefix', () => {
    expect(parseDegreeTilePrefix('N59/E18')).toMatchObject({
      latTile: 59,
      lonTile: 18,
      tileId: '59_18',
    })
  })
})
