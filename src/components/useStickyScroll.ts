import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Follows new content only while you're at the bottom. Scroll up and it stays put (so you can
 * read or press buttons while a reply streams); `away` then offers a jump back to the latest.
 */
export function useStickyScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = useCallback((e: React.UIEvent<T>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAway(!stick.current);
  }, []);
  const jump = useCallback(() => {
    const el = ref.current;
    stick.current = true;
    setAway(false);
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);
  return { ref, onScroll, away, jump };
}
