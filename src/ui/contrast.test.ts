import { describe, expect, it } from 'vitest';
import { AA_NORMAL, SURFACES, contrastRatio, relativeLuminance } from './contrast';

/**
 * The theme is only accessible if these hold. They are asserted against the
 * tokens the theme is built from, so editing `palette.ts` without re-checking
 * contrast fails the build instead of shipping an unreadable screen.
 */
describe('palette contrast (WCAG 2.0 AA)', () => {
  it('measures both colour schemes', () => {
    expect(new Set(SURFACES.map((p) => p.mode))).toEqual(new Set(['dark', 'light']));
  });

  it('has a row for every token/surface pair the interface draws', () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(40);
  });

  for (const pair of SURFACES) {
    it(`${pair.mode} ${pair.token} on ${pair.on} meets ${pair.minimum}:1`, () => {
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.minimum);
    });
  }

  it('keeps the documented ratios stable', () => {
    expect(contrastRatio('#E8EEF2', '#171E23')).toBeCloseTo(14.4, 1);
    expect(contrastRatio('#A9BBC4', '#171E23')).toBeCloseTo(8.5, 1);
    expect(contrastRatio('#122A28', '#FFFFFF')).toBeCloseTo(15.13, 1);
    expect(contrastRatio('#45575C', '#FFFFFF')).toBeCloseTo(7.58, 1);
    expect(contrastRatio('#FFFFFF', '#0F766E')).toBeCloseTo(5.47, 1);
    expect(contrastRatio('#06211F', '#2DD4BF')).toBeCloseTo(9.06, 1);
  });

  it('is not a test that always passes', () => {
    // A control pair: the same luminance maths must reject an unreadable pair.
    const unreadable = contrastRatio('#3A4A52', '#2F3E45');
    expect(unreadable).toBeLessThan(AA_NORMAL);
  });

  it('computes luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('accepts the short hex form', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 6);
  });
});
