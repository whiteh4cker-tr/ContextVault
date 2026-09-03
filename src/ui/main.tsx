import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './AppProviders';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root — index.html and main.tsx disagree');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
