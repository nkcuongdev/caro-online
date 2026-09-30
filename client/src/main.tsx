import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './styles/nameStyles.css';
import './styles/avatarFrames.css';
import { startClockSync } from './lib/clock';
import { unlockAudioOnGesture } from './lib/sound';

startClockSync();
unlockAudioOnGesture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
