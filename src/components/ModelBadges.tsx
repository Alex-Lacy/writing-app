export interface BadgeInfo {
  vision?: boolean;
  tools?: boolean;
  thinking?: 'always' | 'optional';
  cost?: number;
  contextLength?: number;
}

/** Small capability chips: Vision, Tools, Thinks, context size, concurrency cost. */
export function ModelBadges({ m, showCtx = true }: { m: BadgeInfo; showCtx?: boolean }) {
  return (
    <span className="badges">
      {m.thinking && (
        <span className="chip think" title={m.thinking === 'always' ? 'Reasons before every reply (shown collapsed)' : 'Hybrid: can think before replying or answer directly'}>
          🧠 {m.thinking === 'always' ? 'Thinks' : 'Thinking optional'}
        </span>
      )}
      {m.vision && <span className="chip" title="Can read images you attach">👁 Vision</span>}
      {m.tools && <span className="chip" title="Supports tool calls (search, lorebook tools in later phases)">🔧 Tools</span>}
      {showCtx && m.contextLength && <span className="chip muted" title="Model's own context window. Your Featherless plan may cap it lower (32K).">{Math.round(m.contextLength / 1024)}K</span>}
      {m.cost && <span className="chip muted" title="Featherless concurrency units per request (1 small, 2 medium, 4 large). Your plan sets how many you can use at once.">{m.cost === 1 ? 'Light' : m.cost === 2 ? 'Medium' : 'Heavy'}</span>}
    </span>
  );
}
