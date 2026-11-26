// Fitting a side job into the model's context window: prompt + room for the reply must fit.
// Limits come from the model list, or are learned from the provider's error message (plans can
// allow less than the model itself does), and kept in this browser.
import type { WireMessage } from '../providers/openai';
import { estimateTokens } from '../context/tokens';

const KEY = (modelId: string) => `ctx:${modelId}`;

export function knownLimit(modelId: string, listed?: number): number | undefined {
  let learned: number | undefined;
  try { learned = Number(localStorage.getItem(KEY(modelId))) || undefined; } catch { /* no storage */ }
  return learned && listed ? Math.min(learned, listed) : learned ?? listed;
}

/** Reads "maximum context length … is N tokens … prompt has P tokens" style errors. */
export function contextError(msg: string): { limit: number; prompt?: number } | undefined {
  if (!/context length|context window|maximum context|too many tokens/i.test(msg)) return;
  const limit = Number(msg.match(/(?:is|of)\s+(\d{3,7})\s+tokens/i)?.[1]);
  if (!limit) return;
  const prompt = Number(msg.match(/prompt (?:has|is|contains)\s+(\d{2,7})\s+tokens/i)?.[1]) || undefined;
  return { limit, prompt };
}

export function learnLimit(modelId: string, limit: number) {
  try { localStorage.setItem(KEY(modelId), String(limit)); } catch { /* no storage */ }
}

const size = (m: WireMessage) => estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) + 4;

/**
 * Makes the request fit: first gives the reply less room (down to `minOut`), then leaves out the
 * oldest conversation turns (never the first system message or the last message).
 * `scale` corrects our token estimate when the provider told us the real count.
 */
export function fitRequest(messages: WireMessage[], maxOut: number, limit: number | undefined, scale = 1, minOut = 1536): { messages: WireMessage[]; maxOut: number; dropped: number } {
  if (!limit) return { messages, maxOut, dropped: 0 };
  const margin = 256;
  const total = (ms: WireMessage[]) => Math.ceil(ms.reduce((n, m) => n + size(m), 0) * scale);
  let ms = messages;
  let dropped = 0;
  const room = () => limit - total(ms) - margin;
  if (room() >= maxOut) return { messages: ms, maxOut, dropped };
  if (room() >= minOut) return { messages: ms, maxOut: room(), dropped };
  // Leave out the oldest turns after the leading system message(s), keeping the last message.
  const head = ms.findIndex((m) => m.role !== 'system');
  const start = head < 0 ? ms.length : head;
  while (room() < minOut && ms.length - start > 1) {
    ms = [...ms.slice(0, start), ...ms.slice(start + 1)];
    dropped++;
  }
  if (dropped && ms[start]?.role === 'assistant') { ms = [...ms.slice(0, start), ...ms.slice(start + 1)]; dropped++; }
  return { messages: ms, maxOut: Math.max(256, Math.min(maxOut, room())), dropped };
}
