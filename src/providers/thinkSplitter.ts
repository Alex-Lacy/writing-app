/**
 * Splits a streamed text into visible content and reasoning, for models that emit
 * reasoning inline as <think>...</think> (DeepSeek-R1 distills, QwQ, etc.).
 * Handles tags split across chunk boundaries.
 */
export class ThinkSplitter {
  private buf = '';
  private inThink = false;
  private sawAnyContent = false;
  private static OPEN = /<(think|thinking|reasoning)>/i;
  private static CLOSE = /<\/(think|thinking|reasoning)>/i;

  /** Some templates open the think block in the prompt, so output starts mid-reasoning. */
  constructor(startInThink = false) {
    this.inThink = startInThink;
  }

  push(chunk: string): { content: string; reasoning: string } {
    this.buf += chunk;
    let content = '';
    let reasoning = '';
    for (;;) {
      if (this.inThink) {
        const m = ThinkSplitter.CLOSE.exec(this.buf);
        if (m) {
          reasoning += this.buf.slice(0, m.index);
          this.buf = this.buf.slice(m.index + m[0].length).replace(/^\s+/, '');
          this.inThink = false;
          continue;
        }
        const keep = this.partialTail(this.buf);
        reasoning += this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
        break;
      } else {
        const m = ThinkSplitter.OPEN.exec(this.buf);
        // Only treat <think> as reasoning if it appears before any real content.
        if (m && !this.sawAnyContent && this.buf.slice(0, m.index).trim() === '') {
          this.buf = this.buf.slice(m.index + m[0].length);
          this.inThink = true;
          continue;
        }
        const keep = this.sawAnyContent ? 0 : this.partialTail(this.buf);
        const out = this.buf.slice(0, this.buf.length - keep);
        if (out.trim()) this.sawAnyContent = true;
        content += out;
        this.buf = this.buf.slice(this.buf.length - keep);
        break;
      }
    }
    return { content, reasoning };
  }

  flush(): { content: string; reasoning: string } {
    const rest = this.buf;
    this.buf = '';
    return this.inThink ? { content: '', reasoning: rest } : { content: rest, reasoning: '' };
  }

  /** Length of a trailing fragment that could be the start of a tag. */
  private partialTail(s: string): number {
    const i = s.lastIndexOf('<');
    if (i === -1 || s.length - i > 13) return 0;
    return /^<\/?[a-z]*$/i.test(s.slice(i)) ? s.length - i : 0;
  }
}
