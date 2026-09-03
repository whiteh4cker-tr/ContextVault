import {
  createTheme,
  type PaletteColor,
  type PaletteColorOptions,
  type Theme,
} from '@mui/material/styles';
import { PALETTES, type ModePalette, type ThemeMode } from './palette';

/**
 * ContextVault's Material theme.
 *
 * Two plain themes are swapped rather than one `colorSchemes` theme: with CSS
 * theme variables, palette values become `var(--mui-palette-…)` strings, which
 * cannot be fed to `alpha()` or measured for contrast. Every colour here comes
 * from `palette.ts`, whose pairs `contrast.test.ts` holds to WCAG 2.0 AA.
 */
declare module '@mui/material/styles' {
  interface Palette {
    /** AppBar surface — its own colour so the bar can differ from paper. */
    appBar: PaletteColor;
    /** Bubbles for the user's own turns. */
    userBubble: PaletteColor;
    /** Citation chips. */
    chip: PaletteColor;
  }
  interface PaletteOptions {
    appBar?: PaletteColorOptions;
    userBubble?: PaletteColorOptions;
    chip?: PaletteColorOptions;
  }
  interface TypeBackground {
    raised: string;
    chatPanel: string;
    selected: string;
    selectedSecondary: string;
  }
}

const FONT_STACK = "'Roboto', 'Segoe UI', system-ui, sans-serif";

function color(main: string, contrastText: string, light: string, dark: string) {
  return { main, light, dark, contrastText };
}

function build(mode: ThemeMode): Theme {
  const p: ModePalette = PALETTES[mode];

  return createTheme({
    palette: {
      mode,
      primary: color(p.primary, p.onPrimary, mode === 'dark' ? p.accentText : '#0B5F58', '#0B5F58'),
      secondary: color(mode === 'dark' ? '#7DD3FC' : '#0369A1', mode === 'dark' ? '#082F35' : '#FFFFFF', '#38BDF8', '#075985'),
      success: color(p.success, mode === 'dark' ? '#052E16' : '#FFFFFF', p.success, p.success),
      error: color(p.error, mode === 'dark' ? '#450A0A' : '#FFFFFF', p.error, p.error),
      warning: color(p.warning, mode === 'dark' ? '#431407' : '#FFFFFF', p.warning, p.warning),
      appBar: color(p.appBar, p.appBarText, p.appBar, p.appBar),
      userBubble: color(p.userBubble, p.userBubbleText, p.userBubble, p.userBubble),
      chip: color(p.chipBg, p.chipText, p.chipBg, p.chipBg),
      background: {
        default: p.bg,
        paper: p.paper,
        raised: p.raised,
        chatPanel: p.chatPanel,
        selected: p.selected,
        selectedSecondary: p.selectedSecondary,
      },
      text: { primary: p.textPrimary, secondary: p.textSecondary, disabled: p.textDisabled },
      divider: p.divider,
    },

    shape: { borderRadius: 10 },

    typography: {
      fontFamily: FONT_STACK,
      // Material upper-cases button labels by default. Here buttons carry real
      // words the model produced ("gemma-4-12B-it-qat"), where casing matters.
      button: { textTransform: 'none', fontWeight: 600 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      overline: { fontWeight: 600, letterSpacing: '0.08em' },
    },

    components: {
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }: { theme: Theme }) => ({
            backgroundColor: theme.palette.appBar.main,
            color: theme.palette.appBar.contrastText,
            boxShadow: theme.shadows[2],
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ theme }: { theme: Theme }) => ({
            // A visible outline as well as a colour: meaning is never carried by
            // colour alone (WCAG 2.0, 1.4.1).
            border: `1px solid ${theme.palette.divider}`,
            fontWeight: 500,
          }),
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          rounded: { borderRadius: 12 },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999, height: 6 },
          bar: { borderRadius: 999 },
        },
      },
      MuiSlider: {
        defaultProps: { color: 'primary' },
      },
      MuiTooltip: {
        defaultProps: { enterDelay: 300, arrow: true },
      },
      MuiButton: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small' },
      },
    },
  });
}

export const darkTheme: Theme = build('dark');
export const lightTheme: Theme = build('light');

const THEMES: Record<ThemeMode, Theme> = { dark: darkTheme, light: lightTheme };

/** Built once per scheme and reused, so `ThemeProvider` keeps a stable reference. */
export function getTheme(mode: ThemeMode): Theme {
  return THEMES[mode];
}
