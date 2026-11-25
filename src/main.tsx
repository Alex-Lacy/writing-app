import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Ask the browser to keep our data (stories live only on this device). Only when installed: Firefox
// shows a permission prompt for this, which would be odd on a first visit. Settings, Data has a button.
if (matchMedia('(display-mode: standalone)').matches) void navigator.storage?.persist?.().catch(() => {});

// Offline install (not for the dev server or the single-file build opened from disk).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !import.meta.env.DEV) {
  const register = () => void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline support unavailable', e));
  if (document.readyState === 'complete') register();
  else addEventListener('load', register);
}
