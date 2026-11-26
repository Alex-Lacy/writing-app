import { create } from 'zustand';
import type { Pair } from './session';

/** A paired device asking to sync with this one. SyncModal picks it up. */
export const useIncoming = create<{ knock?: { pair: Pair; session: string; at: number }; clear: () => void }>((set) => ({
  clear: () => set({ knock: undefined }),
}));
