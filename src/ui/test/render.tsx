import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../theme';

/**
 * Render inside the app's theme.
 *
 * MUI components resolve colours, breakpoints and elevation from the theme, so a
 * component test without one is testing a tree the product never renders.
 */
export function renderWithTheme(ui: ReactElement, options?: RenderOptions) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      {ui}
    </ThemeProvider>,
    options,
  );
}
