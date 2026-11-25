import { estimateTokens } from '../context/tokens';
import { uid } from '../lib/id';
import { currentChat, saveSettings, updateChat, upsertPreset, useStore } from '../store/store';
import type { GenParams, WritingSettings } from '../types';

function NumField({ label, value, onChange, step = 0.01, min, max, hint, placeholder = 'default' }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; hint?: string; placeholder?: string;
}) {
  return (
    <label className="field num" title={hint}>
      <span>{label}</span>
      <input
        type="number" step={step} min={min} max={max} placeholder={placeholder}
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
          <NumField label="Hard cap (tokens)" hint="Optional safety limit on one reply, thinking included. Leave empty: the Length setting sizes replies, and they can use whatever context is left." value={chat.params.hardCap} placeholder="none" step={256} min={64} onChange={(v) => setParams({ hardCap: v })} />
          <NumField label="Temperature" value={chat.params.temperature} min={0} max={5} onChange={(v) => setParams({ temperature: v })} />
          <NumField label="Top P" value={chat.params.topP} min={0} max={1} onChange={(v) => setParams({ topP: v })} />
          <NumField label="Min P" value={chat.params.minP} min={0} max={1} onChange={(v) => setParams({ minP: v })} />
          <NumField label="Top K" value={chat.params.topK} step={1} min={0} onChange={(v) => setParams({ topK: v })} />
          <NumField label="Repetition pen." value={chat.params.repetitionPenalty} min={0} max={3} onChange={(v) => setParams({ repetitionPenalty: v })} />
          <NumField label="Frequency pen." value={chat.params.frequencyPenalty} min={-2} max={2} onChange={(v) => setParams({ frequencyPenalty: v })} />
          <NumField label="Presence pen." value={chat.params.presencePenalty} min={-2} max={2} onChange={(v) => setParams({ presencePenalty: v })} />
        </div>
        <p className="muted small">
          Reply size comes from the <b>Length</b> option above the message box. Replies may use all the context that is
          left, so thinking models aren't cut off; set a hard cap only if you want an absolute limit.
        </p>
        <button className="ghost small" onClick={() => saveSettings({ defaultParams: chat.params })}>Use as default for new chats</button>
      </section>

      <section>
        <h3>
          <label className="switch">
            <input type="checkbox" checked={w.enabled} onChange={(e) => setW({ enabled: e.target.checked })} /> Writing tools
          </label>
        </h3>
        <fieldset disabled={!w.enabled} className={w.enabled ? '' : 'dim'}>
          <div className="wt-block src-memory">
            <div className="wt-head"><b>Memory</b> <em className="muted small">~{estimateTokens(w.memory)} tokens</em></div>
            <p className="muted small">Always placed at the very top of the context, right after the system prompt. Use it for the things that are always true: premise, characters, setting, style.</p>
            <textarea rows={7} value={w.memory} onChange={(e) => setW({ memory: e.target.value })} placeholder="Story premise, characters, setting, style…" />
          </div>

          <div className="wt-block src-authors-note">
            <div className="wt-head"><b>Author's Note</b> <em className="muted small">~{estimateTokens(w.authorsNote)} tokens</em></div>
            <p className="muted small">
              Placed near the end of the context, so it has a stronger, more immediate effect than Memory. Use it for
              what should steer the next replies: tone, pacing, focus, POV.
            </p>
            <textarea rows={4} value={w.authorsNote} onChange={(e) => setW({ authorsNote: e.target.value })} placeholder="[Style: vivid, slow-burn. Focus on Mara's POV.]" />
            <div className="grid2">
              <label className="field num">
                <span>Insert depth</span>
                <input type="number" min={1} step={1} value={w.anDepth} onChange={(e) => setW({ anDepth: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <label className="field num">
                <span>Insert as</span>
                <select value={w.anRole} onChange={(e) => setW({ anRole: e.target.value as WritingSettings['anRole'] })}>
                  <option value="inline">Inside the message (recommended)</option>
                  <option value="system">Separate system message</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              <b>Depth</b> is how many messages back from the latest one the note goes. 1 = with your latest message
              (strongest). Higher numbers sit further back and pull less. <b>Inside the message</b> works with every
              model; some models (DeepSeek, for one) move separate system messages to the top, which weakens the note.
            </p>
          </div>
          <button className="ghost small" onClick={() => saveSettings({ defaultWriting: { ...w, memory: '', authorsNote: '' } })}>Use toggle + AN settings as default</button>
        </fieldset>
      </section>
    </div>
  );
}
