/**
 * Splits a streamed text into visible content and reasoning, for models that emit reasoning inline
 * as <think>...</think> (DeepSeek-R1 distills, QwQ, Qwen 3.x, etc.). Handles tags split across chunks.
 *
 * Many chat templates (Qwen's among them) open the think block in the prompt itself, so the reply
 * starts mid-reasoning and only the closing tag is ever streamed. Two things cover that:
 * - When thinking is expected, the splitter starts out treating text as reasoning ("provisional").
 *   If the reply ends with no closing tag, or the server sends reasoning in its own field, that
 *   text was the answer after all and is handed back as content.
 * - A closing tag with no opening tag before it turns everything shown so far into reasoning.
 * Either way the splitter returns `moved`: text the caller must take off the end of one field and
 * add to the other.
 */
export interface SplitOut {
  content: string;
  reasoning: string;
  moved?: { to: 'reasoning' | 'content'; text: string };
}

export class ThinkSplitter {
  private buf = '';
  private inThink = false;
  /** In think mode only because thinking was expected; no tag seen yet. */
  private provisional = false;
  private sawTag = false;
  private sawAnyContent = false;
  /** Everything handed out so far as content / as provisional reasoning, for moves. */
  private shown = '';
  private guessed = '';
  private static OPEN = /<(think|thinking|reasoning)>/i;
  private static CLOSE = /<\/(think|thinking|reasoning)>/i;

  constructor(expectThinking = false) {
    this.inThink = this.provisional = expectThinking;
  }

  /** The server sent reasoning in its own field, so the text stream is the answer. */
  reasoningElsewhere(): SplitOut {
    if (!this.provisional) return { content: '', reasoning: '' };
    this.provisional = this.inThink = false;
    const text = this.guessed;
    this.guessed = '';
    this.sawTag = true; // don't second-guess this stream again
    const rest = this.push('');
    return { content: rest.content, reasoning: '', moved: text ? { to: 'content', text } : undefined };
  }

  push(chunk: string): SplitOut {
    this.buf += chunk;
    let content = '';
    let reasoning = '';
    let moved: SplitOut['moved'];
    for (;;) {
      if (this.inThink) {
        // A provisional block may still start with its own opening tag.
        if (this.provisional && !this.guessed) {
          const t = this.buf.trimStart();
          if (!t || (t.length < 12 && /^<[a-z]*$/i.test(t))) break; // could still become one
          const o = /^<(think|thinking|reasoning)>/i.exec(t);
          if (o) {
            this.buf = t.slice(o[0].length);
            this.provisional = false;
            this.sawTag = true;
          }
        }
        const m = ThinkSplitter.CLOSE.exec(this.buf);
        if (m) {
          reasoning += this.buf.slice(0, m.index);
          this.buf = this.buf.slice(m.index + m[0].length).replace(/^\s+/, '');
          this.inThink = this.provisional = false;
          this.sawTag = true;
          this.guessed = '';
          continue;
        }
        const keep = this.partialTail(this.buf);
        const out = this.buf.slice(0, this.buf.length - keep);
        reasoning += out;
        if (this.provisional) this.guessed += out;
        this.buf = this.buf.slice(this.buf.length - keep);
        break;
      } else {
        const m = ThinkSplitter.OPEN.exec(this.buf);
        // Only treat <think> as reasoning if it appears before any real content.
        if (m && !this.sawAnyContent && this.buf.slice(0, m.index).trim() === '') {
          this.buf = this.buf.slice(m.index + m[0].length);
          this.inThink = this.sawTag = true;
          continue;
        }
        const c = !this.sawTag && ThinkSplitter.CLOSE.exec(this.buf);
        if (c && !ThinkSplitter.OPEN.test(this.shown + content + this.buf.slice(0, c.index))) {
          // A lone closing tag: everything before it was reasoning.
          moved = this.shown + content ? { to: 'reasoning', text: this.shown + content } : undefined;
          reasoning += this.buf.slice(0, c.index);
          this.shown = content = '';
          this.buf = this.buf.slice(c.index + c[0].length).replace(/^\s+/, '');
          this.sawTag = true;
          this.sawAnyContent = false;
          continue;
        }
        const keep = this.sawTag && this.sawAnyContent ? 0 : this.partialTail(this.buf);
        const out = this.buf.slice(0, this.buf.length - keep);
        if (out.trim()) this.sawAnyContent = true;
        content += out;
        this.buf = this.buf.slice(this.buf.length - keep);
        break;
      }
    }
    if (!this.sawTag) this.shown += content;
    return { content, reasoning, moved };
  }

  flush(): SplitOut {
    const rest = this.buf;
    this.buf = '';
    if (this.provisional) {
      // Thinking was expected but never closed: it was the answer.
      const text = this.guessed;
      this.guessed = '';
      this.provisional = this.inThink = false;
      return { content: rest, reasoning: '', moved: text ? { to: 'content', text } : undefined };
    }
    return this.inThink ? { content: '', reasoning: rest } : { content: rest, reasoning: '' };
  }

  /** Length of a trailing fragment that could be the start of a tag. */
  private partialTail(s: string): number {
    const i = s.lastIndexOf('<');
    if (i === -1 || s.length - i > 13) return 0;
    return /^<\/?[a-z]*$/i.test(s.slice(i)) ? s.length - i : 0;
  }
}

/** Applies a split's output to the text so far. */
export function applySplit(acc: { content: string; reasoning: string }, out: SplitOut) {
  let { content, reasoning } = acc;
  if (out.moved?.to === 'reasoning') {
    content = content.endsWith(out.moved.text) ? content.slice(0, content.length - out.moved.text.length) : content;
    reasoning += out.moved.text;
  } else if (out.moved?.to === 'content') {
    reasoning = reasoning.endsWith(out.moved.text) ? reasoning.slice(0, reasoning.length - out.moved.text.length) : reasoning;
    content += out.moved.text;
  }
  return { content: content + out.content, reasoning: reasoning + out.reasoning };
}
