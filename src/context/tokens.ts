// Fast, provider-agnostic token estimate. It starts a bit pessimistic (3.3 characters per token)
// so we stay under hard caps like Featherless's 32K, then calibrates from the real prompt token
// counts the server reports, never going more optimistic than 4 characters per token.
const START = 3.3;
let charsPerToken = START;

export const estimateTokens = (text: string): number => (text ? Math.ceil(text.length / charsPerToken) : 0);
export const MESSAGE_OVERHEAD = 5;

/** Feeds one real measurement: the characters we sent and the prompt tokens the server counted. */
export function calibrate(chars: number, tokens: number) {
  if (chars < 2000 || tokens < 200) return; // too small to tell anything
  const seen = chars / tokens;
  // Slow average, and a 5% safety discount, clamped to a sane range.
  charsPerToken = Math.min(4, Math.max(2.5, charsPerToken * 0.8 + seen * 0.95 * 0.2));
}
export const currentCharsPerToken = () => charsPerToken;
export function setCharsPerToken(v: number | undefined) {
  if (v && v >= 2.5 && v <= 4) charsPerToken = v;
}
