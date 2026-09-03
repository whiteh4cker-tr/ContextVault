/** Colour scheme the user can switch between; dark is the default. */
export type ThemeMode = 'dark' | 'light';

const MODE_STORAGE_KEY = 'contextvault.theme';

/** Reads the stored scheme, defaulting to dark. Never throws without a DOM. */
export function getStoredMode(): ThemeMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage is an optimisation here; a disabled store must not break the app.
  }
}

/**
 * The measured colour tokens for one colour scheme.
 *
 * Every value here appears in a row of `SURFACES` in `contrast.ts`, which is
 * asserted against WCAG 2.0 AA in `contrast.test.ts`. Change a token here and a
 * test tells you whether the text on top of it is still readable — that is the
 * whole reason the palette lives in one file instead of inside the theme.
 */
export interface ModePalette {
  /** Page background behind every panel. */
  bg: string;
  /** Sidebar, cards, menus. */
  paper: string;
  /** Cards lifted above the paper (hovered document rows, inputs). */
  raised: string;
  /** Chat transcript surface, one shade between bg and paper. */
  chatPanel: string;

  appBar: string;
  appBarText: string;
  appBarSecondary: string;

  userBubble: string;
  userBubbleText: string;
  assistantBubble: string;

  chipBg: string;
  chipText: string;
  /** Selected list row. */
  selected: string;
  /** Secondary text on a selected row, which needs its own check. */
  selectedSecondary: string;

  textPrimary: string;
  textSecondary: string;
  /** Held to AA as well; disabled text is exempt in WCAG 1.4.3, and this app does not collect exemptions. */
  textDisabled: string;

  /** Accent fill: buttons, active slider track, focus. */
  primary: string;
  /** Text drawn on the accent fill. */
  onPrimary: string;
  /** Accent used as *text* or as an icon, which is a different shade. */
  accentText: string;

  error: string;
  success: string;
  warning: string;
  divider: string;
}

export const DARK: ModePalette = {
  bg: '#0F1417',
  paper: '#171E23',
  raised: '#222D34',
  chatPanel: '#1A252B',

  appBar: '#10181C',
  appBarText: '#E8EEF2',
  appBarSecondary: '#A9BBC4',

  userBubble: '#1C3B39',
  userBubbleText: '#E8EEF2',
  assistantBubble: '#222D34',

  chipBg: '#123C39',
  chipText: '#5EEAD4',
  selected: '#1B2A31',
  selectedSecondary: '#A9BBC4',

  textPrimary: '#E8EEF2',
  textSecondary: '#A9BBC4',
  textDisabled: '#8FA3AD',

  primary: '#2DD4BF',
  onPrimary: '#06211F',
  accentText: '#5EEAD4',

  error: '#F87171',
  success: '#4ADE80',
  warning: '#FDBA74',
  divider: 'rgba(232, 238, 242, 0.16)',
};

export const LIGHT: ModePalette = {
  bg: '#F4F6F8',
  paper: '#FFFFFF',
  raised: '#FFFFFF',
  chatPanel: '#FAFBFC',

  appBar: '#0F766E',
  appBarText: '#FFFFFF',
  appBarSecondary: '#E7F3F1',

  userBubble: '#0B5F58',
  userBubbleText: '#FFFFFF',
  assistantBubble: '#FFFFFF',

  chipBg: '#E7F3F1',
  chipText: '#0B5F58',
  selected: '#EAF1F5',
  selectedSecondary: '#45575C',

  textPrimary: '#122A28',
  textSecondary: '#45575C',
  textDisabled: '#5F7076',

  primary: '#0F766E',
  onPrimary: '#FFFFFF',
  accentText: '#0F766E',

  error: '#DC2626',
  success: '#15803D',
  warning: '#C2410C',
  divider: 'rgba(18, 42, 40, 0.14)',
};

export const PALETTES: Record<ThemeMode, ModePalette> = { dark: DARK, light: LIGHT };
