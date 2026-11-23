// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { BADGE_CLEARANCE, BADGE_INSET, BADGE_SIZE, timeLabelCentre } from './badge'

describe('timeLabelCentre', () => {
  const left = (centre: number, width: number): number => centre - width / 2

  it('keeps the first label off the badge: it starts past the badge and its gap, wherever its tick is', () => {
    // The tick of the first bar sits at the left edge of the plot (x = 52): a 62px "11-17 16:00" would start at x = 21, under the badge.
    expect(BADGE_CLEARANCE).toBe(BADGE_INSET * 2 + BADGE_SIZE)
    for (const position of [0, 4, 21, 52]) expect(left(timeLabelCentre(position, 62, 800, 4), 62)).toBeGreaterThanOrEqual(BADGE_CLEARANCE)
  })

  it('leaves a label that is already clear exactly where its tick is', () => {
    expect(timeLabelCentre(300, 62, 800, 4)).toBe(300)
    expect(left(timeLabelCentre(BADGE_CLEARANCE + 31, 62, 800, 4), 62)).toBe(BADGE_CLEARANCE)
  })

  it('still keeps a label inside the right edge by its margin', () => {
    expect(timeLabelCentre(799, 62, 800, 4) + 31).toBe(796)
    expect(timeLabelCentre(799, 70, 800, 2) + 35).toBe(798)
  })

  it('treats the crosshair time tag the same way, with its smaller margin', () => {
    expect(left(timeLabelCentre(0, 74, 800, 2), 74)).toBe(BADGE_CLEARANCE)
  })

  it('keeps the left clearance when a label is wider than the room', () => {
    expect(left(timeLabelCentre(10, 120, 100, 4), 120)).toBe(BADGE_CLEARANCE)
  })
})
