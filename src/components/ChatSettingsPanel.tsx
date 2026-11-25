import { estimateTokens } from '../context/tokens';
import { uid } from '../lib/id';
import { currentChat, saveSettings, ui, updateChat, upsertPreset, useStore } from '../store/store';
import type { GenParams, WritingSettings } from '../types';

function NumField({ label, value, onChange, step = 0.01, min, max, hint }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; hint?: string;
}) {
  return (
    <label className="field num" title={hint}>
      <span>{label}</span>
      <input
        type="number" step={step} min={min} max={max} placeholder="default"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

export function ChatSettingsPanel() {
  const chat = useStore((s) => currentChat(s));
  const presets = useStore((s) => s.presets);
  if (!chat) return null;

  const setParams = (p: Partial<GenParams>) => updateChat({ params: { ...chat.params, ...p } });
  const setW = (p: Partial<WritingSettings>) => updateChat({ writing: { ...chat.writing, ...p } });
  const w = chat.writing;

  return (
    <div className="panel-body">
      <section>
        <h3>System prompt</h3>
        <div className="row">
          <select
            value={chat.presetId ?? ''}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value);
              updateChat(p ? { presetId: p.id, systemPrompt: p.systemPrompt } : { presetId: undefined });
            }}
          >
            <option value="">Custom</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="ghost small" onClick={() => {
            const name = prompt('Save system prompt as preset named:');
            if (name) { const p = { id: uid(), name, systemPrompt: chat.systemPrompt }; upsertPreset(p); updateChat({ presetId: p.id }); }
          }}>Save as preset</button>
        </div>
        <textarea rows={6} value={chat.systemPrompt} onChange={(e) => updateChat({ systemPrompt: e.target.value, presetId: undefined })} />
        <button className="ghost small" onClick={() => saveSettings({ defaultSystemPrompt: chat.systemPrompt })}>Use as default for new chats</button>
      </section>

      <section>
        <h3>Generation</h3>
        <div className="grid2">
          <NumField label="Reply room (tokens)" hint="Always kept free for the reply when older messages are trimmed. Thinking models get at least 6,144." value={chat.params.maxTokens} step={256} min={16} onChange={(v) => setParams({ maxTokens: v ?? 2048 })} />
          <NumField label="Temperature" value={chat.params.temperature} min={0} max={5} onChange={(v) => setParams({ temperature: v })} />
          <NumField label="Top P" value={chat.params.topP} min={0} max={1} onChange={(v) => setParams({ topP: v })} />
          <NumField label="Min P" value={chat.params.minP} min={0} max={1} onChange={(v) => setParams({ minP: v })} />
          <NumField label="Top K" value={chat.params.topK} step={1} min={0} onChange={(v) => setParams({ topK: v })} />
          <NumField label="Repetition pen." value={chat.params.repetitionPenalty} min={0} max={3} onChange={(v) => setParams({ repetitionPenalty: v })} />
          <NumField label="Frequency pen." value={chat.params.frequencyPenalty} min={-2} max={2} onChange={(v) => setParams({ frequencyPenalty: v })} />
          <NumField label="Presence pen." value={chat.params.presencePenalty} min={-2} max={2} onChange={(v) => setParams({ presencePenalty: v })} />
        </div>
        <label className="switch small" title="Off: replies stop at exactly the Reply room number.">
          <input type="checkbox" checked={chat.params.autoMaxTokens !== false} onChange={(e) => setParams({ autoMaxTokens: e.target.checked })} />
          Let replies use all remaining context (recommended, needed for thinking models)
        </label>
        <button className="ghost small" onClick={() => saveSettings({ defaultParams: chat.params })}>Use as default for new chats</button>
      </section>

      <section>
        <h3>
          <label className="switch">
            <input type="checkbox" checked={w.enabled} onChange={(e) => setW({ enabled: e.target.checked })} /> Writing tools
          </label>
        </h3>
        <fieldset disabled={!w.enabled} className={w.enabled ? '' : 'dim'}>
          <label className="field">
            <span>Memory <em className="muted">~{estimateTokens(w.memory)} tokens, always at the top of context</em></span>
            <textarea rows={7} value={w.memory} onChange={(e) => setW({ memory: e.target.value })} placeholder="Story premise, characters, setting, style…" />
          </label>
          <label className="field">
            <span>Author's Note <em className="muted">~{estimateTokens(w.authorsNote)} tokens</em></span>
            <textarea rows={4} value={w.authorsNote} onChange={(e) => setW({ authorsNote: e.target.value })} placeholder="[Style: vivid, slow-burn. Focus on Mara's POV.]" />
          </label>
          <div className="grid2">
            <label className="field num" title="How many messages from the end. 1 = just before the latest message.">
              <span>Insert depth</span>
              <input type="number" min={1} step={1} value={w.anDepth} onChange={(e) => setW({ anDepth: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label className="field num" title="System works for most models. Inline folds the note into the next message for models whose templates reject mid-chat system messages (e.g. Gemma, some Mistral).">
              <span>Insert as</span>
              <select value={w.anRole} onChange={(e) => setW({ anRole: e.target.value as WritingSettings['anRole'] })}>
                <option value="system">System message</option>
                <option value="inline">Inline [bracketed]</option>
              </select>
            </label>
          </div>
          <button className="ghost small" onClick={() => saveSettings({ defaultWriting: { ...w, memory: '', authorsNote: '' } })}>Use toggle + AN settings as default</button>
        </fieldset>
      </section>
      <button className="ghost wide" onClick={() => ui.setPanel('context')}>View exact context sent →</button>
    </div>
  );
}
