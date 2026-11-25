// Fast, provider-agnostic token estimate. Deliberately a bit pessimistic so we stay under
// hard caps like Featherless's 32K. Swap in a real tokenizer later via setTokenizer().
let impl = (text: string): number => Math.ceil(text.length / 3.3);

export const estimateTokens = (text: string): number => (text ? impl(text) : 0);
export const MESSAGE_OVERHEAD = 5;

export function setTokenizer(fn: (text: string) => number) {
  impl = fn;
}
