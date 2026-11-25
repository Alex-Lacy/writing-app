import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline install (not for the dev server or the single-file build opened from disk).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !import.meta.env.DEV) {
  const register = () => void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline support unavailable', e));
  if (document.readyState === 'complete') register();
  else addEventListener('load', register);
}
