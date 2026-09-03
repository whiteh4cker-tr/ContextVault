import { DARK, LIGHT, type ModePalette, type ThemeMode } from './palette';

/**
 * WCAG 2.0 contrast maths and the table of every text/background pair the
 * interface actually draws.
 *
 * The point of `SURFACES` is that it is generated from the same tokens the
 * theme uses: a palette edit is checked by the test suite rather than by eye.
 */

/** 1.4.3 — normal text. */
export const AA_NORMAL = 4.5;
/** 1.4.3 — large text (≥ 24 px, or ≥ 18.66 px bold). */
export const AA_LARGE = 3;
/** 1.4.11 — non-text: icons, focus rings, slider tracks, borders that carry meaning. */
export const AA_NON_TEXT = 3;

export const WCAG = { AA_NORMAL, AA_LARGE, AA_NON_TEXT } as const;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.0 relative luminance. Accepts `#rgb` and `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastPair {
  mode: ThemeMode;
  /** Token name as the design notes refer to it, e.g. `text.secondary`. */
  token: string;
  /** Name of the surface it is drawn on. */
  on: string;
  fg: string;
  bg: string;
  /** AA threshold this pair must clear. */
  minimum: number;
}

type Row = readonly [token: string, on: keyof ModePalette, fg: keyof ModePalette, bg: keyof ModePalette, minimum?: number];

/**
 * The pairs the UI renders. Both colour schemes are checked against the same
 * rows, so a token added for one scheme cannot skip a check.
 */
const ROWS: readonly Row[] = [
  ['text.primary', 'bg', 'textPrimary', 'bg'],
  ['text.primary', 'paper', 'textPrimary', 'paper'],
  ['text.primary', 'raised', 'textPrimary', 'raised'],
  ['text.primary', 'chatPanel', 'textPrimary', 'chatPanel'],
  ['text.primary', 'selected', 'textPrimary', 'selected'],
  ['text.secondary', 'paper', 'textSecondary', 'paper'],
  ['text.secondary', 'bg', 'textSecondary', 'bg'],
  ['text.secondary', 'raised', 'textSecondary', 'raised'],
  ['text.secondary', 'selected', 'textSecondary', 'selected'],
  ['text.disabled', 'paper', 'textDisabled', 'paper'],
  ['accent as text', 'paper', 'accentText', 'paper'],
  ['accent as text', 'chatPanel', 'accentText', 'chatPanel'],
  ['onPrimary', 'primary', 'onPrimary', 'primary'],
  ['appBar.title', 'appBar', 'appBarText', 'appBar'],
  ['appBar.secondary', 'appBar', 'appBarSecondary', 'appBar'],
  ['userBubble.text', 'userBubble', 'userBubbleText', 'userBubble'],
  ['chip.text', 'chipBg', 'chipText', 'chipBg'],
  ['error as text', 'paper', 'error', 'paper'],
  ['success as text', 'paper', 'success', 'paper'],
  ['warning as text', 'paper', 'warning', 'paper'],
  ['primary non-text (slider, focus)', 'paper', 'primary', 'paper', AA_NON_TEXT],
  ['primary icon (non-text)', 'bg', 'primary', 'bg', AA_NON_TEXT],
  ['accent icon (non-text)', 'chatPanel', 'accentText', 'chatPanel', AA_NON_TEXT],
] as const;

/**
 * Pairs that exist in one colour scheme only. Light mode paints the AppBar
 * *with* the accent, so "accent icon on the bar" is not a pair that occurs —
 * dark mode has it, under the streaming chip.
 */
const EXTRA: readonly ContrastPair[] = [
  {
    mode: 'dark',
    token: 'accent chip (non-text)',
    on: 'appBar',
    fg: DARK.accentText,
    bg: DARK.appBar,
    minimum: AA_NON_TEXT,
  },
];

function build(mode: ThemeMode, palette: ModePalette): ContrastPair[] {
  return ROWS.map(([token, on, fg, bg, minimum]) => ({
    mode,
    token,
    on,
    fg: palette[fg],
    bg: palette[bg],
    minimum: minimum ?? AA_NORMAL,
  }));
}

export const SURFACES: readonly ContrastPair[] = [...build('dark', DARK), ...build('light', LIGHT), ...EXTRA];
