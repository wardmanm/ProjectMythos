import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createApp } from '@/app/app';
import { createAppRouter } from '@/app/router';
import { houseTheme } from '@/theme/house-theme';
import { applyTheme, preferredScheme } from '@/theme/theme-root';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no element with id "root"');
}

// Before the first render, so the page never shows unthemed (UI-032). ThemeRoot keeps
// it current from here on.
applyTheme(document.documentElement, houseTheme, preferredScheme());

const app = createApp(createAppRouter());
createRoot(container).render(
  <StrictMode>
    <App {...app} />
  </StrictMode>,
);
