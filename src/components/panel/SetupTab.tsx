import { NumberInput } from '../NumberInput';
import { useState } from 'react';
import { estimateTokens } from '../../context/tokens';
import { uid } from '../../lib/id';
import { currentChat, DEFAULT_UPDATES_EVERY, saveSettings, updateChat, upsertPreset, useStore } from '../../store/store';
import { MATURE_PROMPT, STORY_PROMPT, type GenParams, type WritingSettings } from '../../types';
import { SummarySection } from './SummarySection';
import { TagsSection } from './TagsSection';
import { ui } from '../../store/store';

function StyleToggles() {
  const chat = useStore((s) => currentChat(s));
  const styles = useStore((s) => s.settings.styles) ?? [];
  if (!chat) return null;
  const ids = chat.styleIds ?? [];
  return (
    <section className="wt-block src-style">
      <div className="wt-head"><b>Style modules</b> <em className="muted small">sent right after Background</em></div>
      {styles.length === 0 && <p className="muted small">None in the Library yet.</p>}
      {styles.map((m) => (
        <label key={m.id} className="switch small" title={m.text.slice(0, 300)}>
          <input type="checkbox" checked={ids.includes(m.id)} onChange={(e) => updateChat({ styleIds: e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id) })} />
          {m.name} <span className="muted">~{estimateTokens(m.text)} tokens</span>
        </label>
      ))}
      <button className="small ghost" onClick={() => ui.openLibrary(true)}>Edit in the Library</button>
    </section>
  );
}

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

export function SetupTab() {
  const chat = useStore((s) => currentChat(s));
  const presets = useStore((s) => s.presets);
  const defaultPrompt = useStore((s) => s.settings.defaultSystemPrompt);
  const globalNotes = useStore((s) => s.settings.globalNotes);
  const [saved, setSaved] = useState(false);
  if (!chat) return null;

  const setParams = (p: Partial<GenParams>) => updateChat({ params: { ...chat.params, ...p } });
  const setW = (p: Partial<WritingSettings>) => updateChat({ writing: { ...chat.writing, ...p } });
  const w = chat.writing;

  const saveDefaults = async () => {
    await saveSettings({
      defaultSystemPrompt: chat.systemPrompt,
      defaultWriting: { ...w, enabled: true, background: '', steering: '' },
      defaultParams: chat.params,
      defaultAutoSummary: chat.autoSummary !== false,
      defaultUpdatesEvery: chat.updatesEvery ?? DEFAULT_UPDATES_EVERY,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="panel-body">
      <details className="section system-prompt">
        <summary><b>System prompt</b> <span className="muted small">the AI's role and rules</span></summary>
        <div className="row">
          <select
            value={
              presets.some((p) => p.id === chat.presetId) ? chat.presetId
                : chat.systemPrompt === defaultPrompt ? 'default'
                  : chat.systemPrompt === STORY_PROMPT ? 'builtin'
                    : chat.systemPrompt === MATURE_PROMPT ? 'mature' : ''
            }
            onChange={(e) => {
              const v = e.target.value;
              const p = presets.find((x) => x.id === v);
              if (p) updateChat({ presetId: p.id, systemPrompt: p.systemPrompt });
              else if (v === 'default') updateChat({ presetId: undefined, systemPrompt: defaultPrompt });
              else if (v === 'builtin') updateChat({ presetId: undefined, systemPrompt: STORY_PROMPT });
              else if (v === 'mature') updateChat({ presetId: undefined, systemPrompt: MATURE_PROMPT });
              else updateChat({ presetId: undefined });
            }}
          >
            <option value="">Custom</option>
            <option value="default" title="The one set in Settings for new stories">Default</option>
            {defaultPrompt !== STORY_PROMPT && <option value="builtin" title="The app's original story prompt">Original</option>}
            {defaultPrompt !== MATURE_PROMPT && <option value="mature" title="For adult fiction: explicit content without refusals or disclaimers">Mature fiction (uncensored)</option>}
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="ghost small" onClick={() => {
            const name = prompt('Save this system prompt as a preset named:');
            if (name) { const p = { id: uid(), name, systemPrompt: chat.systemPrompt }; upsertPreset(p); updateChat({ presetId: p.id }); }
          }}>Save as preset</button>
        </div>
        <textarea rows={6} value={chat.systemPrompt} onChange={(e) => updateChat({ systemPrompt: e.target.value, presetId: undefined })} />
      </details>

      <div className="wt-block src-background">
        <div className="wt-head"><b>Background</b> <em className="muted small">~{estimateTokens(w.background)} tokens</em></div>
        <p className="muted small">Always sent, at the top. For what's always true: premise, characters, setting, style.</p>
        <textarea rows={7} value={w.background} onChange={(e) => setW({ background: e.target.value })} placeholder="Story premise, characters, setting, style…" />
      </div>

      <div className="wt-block src-steering">
        <div className="wt-head"><b>Steering</b> <em className="muted small">~{estimateTokens(w.steering)} tokens</em></div>
        <p className="muted small">Sent just before each reply, so it pulls hardest on what comes next: tone, pacing, focus, point of view. Keep it short.</p>
        <textarea rows={4} value={w.steering} onChange={(e) => setW({ steering: e.target.value })} placeholder="[Style: vivid, slow-burn. Focus on Mara's POV.]" />
        <details>
          <summary className="muted small">Where it goes</summary>
          <div className="grid2">
            <label className="field num">
              <span>Messages back</span>
              <NumberInput min={1} step={1} fallback={1} value={w.steeringDepth} onChange={(n) => setW({ steeringDepth: Math.round(n) })} />
            </label>
            <label className="field num">
              <span>Insert as</span>
              <select value={w.steeringMode} onChange={(e) => setW({ steeringMode: e.target.value as WritingSettings['steeringMode'] })}>
                <option value="inline">Inside the message (recommended)</option>
                <option value="system">Separate system message</option>
              </select>
            </label>
          </div>
          <p className="muted small">
            1 = with your latest message (strongest); higher numbers sit further back and pull less. <b>Inside the
            message</b> works with every model; some (DeepSeek, for one) move separate system messages to the top,
            which weakens the note.
          </p>
        </details>
      </div>
      <StyleToggles />
      <TagsSection />

      <section>
        <label className="switch" title="Global notes are written in the Library and go into every story that has this on.">
          <input type="checkbox" checked={chat.globalNotes !== false} onChange={(e) => updateChat({ globalNotes: e.target.checked })} /> Include Global notes
        </label>
        <p className="muted small">{globalNotes?.trim() ? `~${estimateTokens(globalNotes)} tokens, edited in the Library.` : 'No Global notes yet. Add them in the Library (sidebar).'}</p>
      </section>

      <SummarySection />

      <details className="section">
        <summary><b>Generation settings</b> <span className="muted small">temperature, samplers, hard cap</span></summary>
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
      </details>

      <button className="ghost small" onClick={saveDefaults} title="New stories start with this system prompt, Steering placement, generation settings, Auto-summary and update settings. Your Background and Steering text aren't copied.">
        {saved ? 'Saved' : 'Use these settings for new stories'}
      </button>

    </div>
  );
}
