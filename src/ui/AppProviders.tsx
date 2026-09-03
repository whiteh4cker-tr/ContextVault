import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import { ColorModeContext } from './colorMode';
import { getStoredMode, storeMode } from './palette';
import { getTheme } from './theme';
import type { ReactNode } from 'react';
import type { ThemeMode } from './palette';

/**
 * Theme plus the preference that selects it.
 *
 * Dark is the default because this is a window people stare into for hours, and
 * the dark palette is the one the contrast suite was written against first. The
 * choice persists in localStorage — the only thing this application stores
 * outside its own data folder, other than the documents it indexes.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredMode());

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: ThemeMode) => {
        setMode(next);
        storeMode(next);
      },
      toggleMode: () => {
        const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
        setMode(next);
        storeMode(next);
      },
    }),
    [mode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={getTheme(mode)}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
