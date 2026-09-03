import DarkMode from '@mui/icons-material/DarkMode';
import LightMode from '@mui/icons-material/LightMode';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { AiStatusChip } from './AiStatusChip';
import { ModelChip } from './ModelChip';
import { RamGauge } from './RamGauge';
import type { LLMState, SystemStats } from '../../shared/types';

interface Props {
  state: LLMState;
  stats: SystemStats | null;
  dark: boolean;
  onToggleTheme(): void;
}

/**
 * The title bar: what this is, what is answering, and what that costs.
 *
 * The three facts here are the ones that change while you work and that you
 * cannot infer from the transcript — the model in use, the engine's phase, and
 * how much memory is left under it.
 */
export function TopAppBar({ state, stats, dark, onToggleTheme }: Props) {
  return (
    <AppBar position="static" elevation={0} color="default">
      <Toolbar variant="dense" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
          ContextVault
        </Typography>
        <ModelChip file={state.activeGgufFile} contextSize={state.contextSize} />
        <AiStatusChip state={state} />

        <Box sx={{ ml: 'auto' }}>
          <RamGauge stats={stats} />
        </Box>

        <Tooltip title={dark ? 'Switch to light colours' : 'Switch to dark colours'}>
          <IconButton onClick={onToggleTheme} size="small" aria-label={dark ? 'Use light theme' : 'Use dark theme'}>
            {dark ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}