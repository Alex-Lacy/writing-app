import { useCallback, useState } from 'react';

// Unsent text, kept per box (story, Helper) and per story, so switching tabs, closing the panel,
// changing story or reloading doesn't lose it. Stored in this browser only.
const KEY = (k: string) => `draft:${k}`;
const read = (k?: string) => (k ? localStorage.getItem(KEY(k)) ?? '' : '');
function write(k: string | undefined, t: string) {
  if (!k) return;
  try {
    if (t) localStorage.setItem(KEY(k), t);
    else localStorage.removeItem(KEY(k));
  } catch {
    /* storage full or blocked: the draft just isn't kept */
  }
}

export function useDraft(key: string | undefined): [string, (t: string) => void] {
  const [state, setState] = useState(() => ({ key, text: read(key) }));
  let cur = state;
  if (state.key !== key) {
    cur = { key, text: read(key) };
    setState(cur);
  }
  const set = useCallback((t: string) => {
    setState({ key, text: t });
    write(key, t);
  }, [key]);
  return [cur.text, set];
}
