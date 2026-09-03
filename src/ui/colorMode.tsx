import { createContext, useContext } from 'react';
import type { ThemeMode } from './palette';

export interface ColorModeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

/**
 * Declared in its own module so each file exports one kind of thing, which is
 * what React Fast Refresh wants: components in components, context here.
 */
export const ColorModeContext = createContext<ColorModeValue | null>(null);

/** Read and change the colour scheme. Provided by `<AppProviders />`. */
export function useColorMode(): ColorModeValue {
  const value = useContext(ColorModeContext);
  if (!value) throw new Error('useColorMode must be used inside <AppProviders>');
  return value;
}
