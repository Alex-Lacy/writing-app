import { useEffect, useMemo, useState } from 'react';
import { repo } from '../db/db';
import { uid } from '../lib/id';
import { friendlyError, listModelsPage, PAGE_SIZE, type RemoteModel } from '../providers/openai';
import { recommendedFor, type RecommendedModel } from '../providers/recommended';
import { ModelBadges } from './ModelBadges';
import type { AppSettings, Job, ModelEntry, Theme } from '../types';
import { JOB_LABEL } from '../ai/jobs';

const listCache = new Map<string, RemoteModel[]>();
import {
  type SettingsTab, deleteModel, deletePreset, deleteProvider, init, modelLabel, saveSettings, ui, upsertModel, upsertPreset, upsertProvider, useStore,
} from '../store/store';
import type { ProviderConfig } from '../types';

type Tab = SettingsTab;

export function SettingsModal() {
  const tab = useStore((s) => s.settingsTab);
  const setTab = ui.setSettingsTab;
  return (
    <div className="modal-scrim" onClick={() => ui.openSettings(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="icon" onClick={() => ui.openSettings(false)}>✕</button>
        </header>
        <div className="tabs">
          {(['providers', 'models', 'presets', 'general', 'data'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <div className="modal-body">
          {tab === 'providers' && <Providers onDone={() => setTab('models')} />}
          {tab === 'models' && <Models />}
          {tab === 'presets' && <Presets />}
          {tab === 'general' && <General />}
          {tab === 'data' && <Data />}
        </div>
      </div>
    </div>
  );
}

function Providers({ onDone }: { onDone: () => void }) {
  const providers = useStore((s) => s.providers);
  const [status, setStatus] = useState<Record<string, string>>({});
  const update = (p: ProviderConfig, patch: Partial<ProviderConfig>) => upsertProvider({ ...p, ...patch });

  const test = async (p: ProviderConfig) => {
    setStatus((s) => ({ ...s, [p.id]: 'Testing…' }));
    try {
      const list = await listModelsPage(p, 1);
      setStatus((s) => ({ ...s, [p.id]: `✓ Connected, ${list.length >= PAGE_SIZE ? `${list.length.toLocaleString()}+` : list.length.toLocaleString()} models available` }));
    } catch (e) {
      setStatus((s) => ({ ...s, [p.id]: `✗ ${friendlyError(e, p.name)}` }));
    }
  };

  return (
    <div>
      <p className="muted small">Any OpenAI-compatible API works. Keys are stored only in this browser.</p>
      {providers.map((p) => (
        <div key={p.id} className="card">
          <div className="grid2">
            <label className="field"><span>Name</span><input value={p.name} onChange={(e) => update(p, { name: e.target.value })} /></label>
            <label className="field"><span>Context cap (tokens)</span><input type="number" value={p.contextLimit} onChange={(e) => update(p, { contextLimit: Number(e.target.value) || 8192 })} /></label>
          </div>
          <label className="field"><span>Base URL</span><input value={p.baseUrl} onChange={(e) => update(p, { baseUrl: e.target.value.trim() })} /></label>
          <label className="field"><span>API key</span><input type="password" autoComplete="off" value={p.apiKey} onChange={(e) => update(p, { apiKey: e.target.value.trim() })} placeholder="sk-… / Featherless key" /></label>
          <div className="row">
            <button onClick={() => test(p)}>Test connection</button>
            <button className="ghost" onClick={onDone}>Pick models →</button>
            <div className="spacer" />
            {providers.length > 1 && <button className="ghost danger" onClick={() => confirm(`Remove ${p.name}?`) && deleteProvider(p.id)}>Remove</button>}
          </div>
          {status[p.id] && <p className="small">{status[p.id]}</p>}
        </div>
      ))}
      <button className="ghost" onClick={() => upsertProvider({ id: uid(), name: 'New provider', baseUrl: 'https://', apiKey: '', contextLimit: 32768 })}>+ Add provider</button>
    </div>
  );
}

function Models() {
  const providers = useStore((s) => s.providers);
  const models = useStore((s) => s.models);
  const defaultKey = useStore((s) => s.settings.defaultModelKey);
  const [pid, setPid] = useState(providers[0]?.id ?? '');
  const [remote, setRemote] = useState<RemoteModel[] | null>(null);
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState('');
  const provider = providers.find((p) => p.id === pid);
  const recommended = provider ? recommendedFor(provider.baseUrl) : [];

  const addRec = (r: RecommendedModel) =>
    provider && upsertModel({ key: `${provider.id}::${r.id}`, providerId: provider.id, modelId: r.id, nickname: r.nickname, contextLength: r.contextLength, vision: r.vision, tools: r.tools, thinking: r.thinking });

  // Loads every page one at a time, ~1.5s apart, to stay under Featherless's limit of
  // 30 requests per 45s. Results are cached for the session so reopening Settings is free.
  const fetchList = async () => {
    if (!provider) return;
    const cached = listCache.get(provider.id);
    if (cached) return setRemote(cached);
    let all: RemoteModel[] = [];
    try {
      for (let page = 1; page <= 25; page++) {
        setBusy(page === 1 ? 'Loading…' : `Loading… ${all.length.toLocaleString()} so far`);
        const batch = await listModelsPage(provider, page);
        const seen = new Set(all.map((m) => m.id));
        const fresh = batch.filter((m) => !seen.has(m.id));
        all = [...all, ...fresh];
        setRemote([...all].sort((a, b) => a.id.localeCompare(b.id)));
        if (batch.length < PAGE_SIZE || fresh.length === 0) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      all.sort((a, b) => a.id.localeCompare(b.id));
      listCache.set(provider.id, all);
      setBusy('');
    } catch (e) {
      setBusy(`✗ ${friendlyError(e, provider.name)}${all.length ? ` (kept ${all.length.toLocaleString()} loaded so far)` : ''}`);
    }
  };
  const filtered = useMemo(() => {
    if (!remote) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return remote.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t))).slice(0, 200);
  }, [remote, q]);
  const add = (modelId: string, contextLength?: number, vision?: boolean, tools?: boolean) => {
    if (!provider) return;
    upsertModel({ key: `${provider.id}::${modelId}`, providerId: provider.id, modelId, contextLength, vision, tools });
  };

  return (
    <div>
      <h3>Your models</h3>
      {models.length === 0 && <p className="muted small">None yet. Add some recommended ones below, or fetch the full list.</p>}
      {models.map((m) => (
        <div key={m.key} className="model-row">
          <input className="nick" value={m.nickname ?? ''} placeholder={modelLabel({ ...m, nickname: undefined })} onChange={(e) => upsertModel({ ...m, nickname: e.target.value || undefined })} title="Nickname" />
          <span className="muted small model-id" title={m.modelId}>{m.modelId} · {providers.find((p) => p.id === m.providerId)?.name} <ModelBadges m={m} showCtx={false} /></span>
          <input className="ctx" type="number" value={m.contextLength ?? ''} placeholder="ctx" title="Model context length (optional)" onChange={(e) => upsertModel({ ...m, contextLength: e.target.value ? Number(e.target.value) : undefined })} />
          <select className="think-sel" value={m.thinking ?? ''} title="Does this model think before replying? Turns on the Thinking control in chat." onChange={(e) => upsertModel({ ...m, thinking: (e.target.value || undefined) as ModelEntry['thinking'] })}>
            <option value="">No thinking</option>
            <option value="optional">Thinking optional</option>
            <option value="always">Always thinks</option>
          </select>
          <label className="small" title="Default model for new stories"><input type="radio" checked={defaultKey === m.key} onChange={() => saveSettings({ defaultModelKey: m.key })} /> default</label>
          <button className="icon" onClick={() => deleteModel(m.key)} title="Remove">✕</button>
        </div>
      ))}

      {recommended.length > 0 && provider && (
        <>
          <h3>Recommended for {provider.name}</h3>
          <p className="muted small">Hand-picked from Featherless's ~10,000 models using current writing and roleplay benchmarks. One click adds the model with a nickname. Heavy models write best but use more of your plan's concurrency and need a plan that includes them.</p>
          {[...new Set(recommended.map((r) => r.group))].map((g) => (
            <div key={g} className="rec-group">
              <div className="rec-head">
                <b className="small">{g}</b>
                <button className="ghost small" onClick={() => recommended.filter((r) => r.group === g).forEach((r) => !models.some((x) => x.key === `${pid}::${r.id}`) && addRec(r))}>Add all</button>
              </div>
              {recommended.filter((r) => r.group === g).map((r) => {
                const added = models.some((x) => x.key === `${pid}::${r.id}`);
                return (
                  <div key={r.id} className="remote-row">
                    <div className="rec-main">
                      <div><b>{r.nickname}</b> <ModelBadges m={r} /></div>
                      <div className="muted small">{r.note}</div>
                      <div className="muted tiny" title={r.id}>{r.id}</div>
                    </div>
                    <button className="small" disabled={added} onClick={() => addRec(r)}>{added ? 'Added' : 'Add'}</button>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      <h3>Add from provider</h3>
      <div className="row">
        <select value={pid} onChange={(e) => { setPid(e.target.value); setRemote(null); }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={fetchList} disabled={busy.startsWith('Loading')}>Fetch model list</button>
        <span className="small">{busy}</span>
      </div>
      {remote && (
        <>
          <input placeholder={`Search ${remote.length.toLocaleString()} models (e.g. "llama 70b", "mistral nemo")`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="remote-list">
            {filtered.map((m) => {
              const added = models.some((x) => x.key === `${pid}::${m.id}`);
              return (
                <div key={m.id} className="remote-row">
                  <span title={m.id}>{m.id}</span>
                  <ModelBadges m={m} />
                  <button className="small" disabled={added} onClick={() => add(m.id, m.contextLength, m.vision, m.tools)}>{added ? 'Added' : 'Add'}</button>
                </div>
              );
            })}
            {filtered.length === 200 && <p className="muted small">Showing first 200, refine the search.</p>}
          </div>
        </>
      )}
      <div className="row">
        <input placeholder="…or type a model id exactly" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button disabled={!manual.trim()} onClick={() => { add(manual.trim()); setManual(''); }}>Add</button>
      </div>
      <JobModelsSection />
    </div>
  );
}

function Presets() {
  const presets = useStore((s) => s.presets);
  return (
    <div>
      <p className="muted small">Saved system prompts. Pick one per story in the Story panel, Setup, System prompt.</p>
      {presets.map((p) => (
        <div key={p.id} className="card">
          <div className="row">
            <input value={p.name} onChange={(e) => upsertPreset({ ...p, name: e.target.value })} />
            <button className="icon" onClick={() => confirm(`Delete preset "${p.name}"?`) && deletePreset(p.id)}>✕</button>
          </div>
          <textarea rows={4} value={p.systemPrompt} onChange={(e) => upsertPreset({ ...p, systemPrompt: e.target.value })} />
        </div>
      ))}
      <button className="ghost" onClick={() => upsertPreset({ id: uid(), name: 'New preset', systemPrompt: '' })}>+ Add preset</button>
    </div>
  );
}

function General() {
  const s = useStore((x) => x.settings);
  return (
    <div>
      <label className="field"><span>System prompt for new stories</span>
        <textarea rows={4} value={s.defaultSystemPrompt} onChange={(e) => saveSettings({ defaultSystemPrompt: e.target.value })} />
      </label>
      <label className="switch"><input type="checkbox" checked={s.enterToSend} onChange={(e) => saveSettings({ enterToSend: e.target.checked })} /> Enter sends (Shift+Enter for newline; always off on touch screens)</label>
      <label className="field num"><span>Context safety margin (tokens)</span>
        <input type="number" value={s.safetyMargin} onChange={(e) => saveSettings({ safetyMargin: Math.max(0, Number(e.target.value) || 0) })} />
      </label>
      <h3>Appearance</h3>
      <div className="grid2">
        <label className="field"><span>Theme</span>
          <select value={s.theme} onChange={(e) => saveSettings({ theme: e.target.value as Theme })}>
            <option value="system">Match my device</option><option value="dark">Dark</option><option value="black">Black (OLED)</option><option value="light">Light</option><option value="sepia">Sepia</option>
          </select>
        </label>
        <label className="field"><span>Story font</span>
          <select value={s.storyFont ?? 'serif'} onChange={(e) => saveSettings({ storyFont: e.target.value as AppSettings['storyFont'] })}>
            <option value="serif">Book (serif)</option><option value="sans">Clean (sans-serif)</option><option value="mono">Typewriter (monospace)</option>
          </select>
        </label>
        <label className="field"><span>Story text size: {s.storyFontSize ?? 17}px</span>
          <input type="range" min={13} max={28} value={s.storyFontSize ?? 17} onChange={(e) => saveSettings({ storyFontSize: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Line spacing: {(s.storyLineHeight ?? 1.65).toFixed(2)}</span>
          <input type="range" min={1.2} max={2.2} step={0.05} value={s.storyLineHeight ?? 1.65} onChange={(e) => saveSettings({ storyLineHeight: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Story column width: {s.storyWidth ?? 820}px</span>
          <input type="range" min={520} max={1400} step={20} value={s.storyWidth ?? 820} onChange={(e) => saveSettings({ storyWidth: Number(e.target.value) })} />
        </label>
        <label className="field"><span>Interface text size: {s.uiFontSize ?? 15}px</span>
          <input type="range" min={12} max={20} value={s.uiFontSize ?? 15} onChange={(e) => saveSettings({ uiFontSize: Number(e.target.value) })} />
        </label>
      </div>
      <p className="msg-body" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
        Rain hammered the tin roofs as Mara stepped onto the pier. “You’re the detective,” he said.
      </p>
    </div>
  );
}

/** Advanced: a different model for each side job. Most people never need this. */
function JobModelsSection() {
  const s = useStore((x) => x.settings);
  const models = useStore((x) => x.models);
  const jm = s.jobModels ?? {};
  const set = (job: Job, key: string) => saveSettings({ jobModels: { ...jm, [job]: key || undefined } });
  return (
    <details>
      <summary>Advanced: models for side jobs</summary>
      <p className="muted small">
        Side jobs are the Helper, Proofread, suggested updates, summaries and Cliché fixes. On Featherless they use
        a strong model for the Helper and Proofread and a fast one for the rest; with other providers they use your
        story model. Rewrites always use the story model unless you pick one here.
      </p>
      <div className="grid2">
        {(Object.keys(JOB_LABEL) as Job[]).map((job) => (
          <label key={job} className="field small"><span>{JOB_LABEL[job]}</span>
            <select value={jm[job] ?? ''} onChange={(e) => set(job, e.target.value)}>
              <option value="">Default</option>
              {models.map((m) => <option key={m.key} value={m.key}>{m.nickname || m.modelId}</option>)}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}

/** Whether the browser has promised not to clear our data when space runs low (Safari clears unused sites' data). */
function StorageStatus() {
  const [st, setSt] = useState<{ persisted: boolean; used?: number } | null>(null);
  useEffect(() => {
    void (async () => {
      if (!navigator.storage?.persisted) return;
      const est = await navigator.storage.estimate?.();
      setSt({ persisted: await navigator.storage.persisted(), used: est?.usage });
    })();
  }, []);
  if (!st) return null;
  const mb = st.used !== undefined ? ` Using about ${Math.max(1, Math.round(st.used / 1e6))} MB.` : '';
  return st.persisted
    ? <p className="muted small">✓ Storage is protected: the browser won't clear it to free space.{mb}</p>
    : (
      <p className="small">
        The browser may clear this data if the device runs low on space or the app goes unused for a long time
        (Safari does this after a few weeks). Installing the app usually protects it.{mb}{' '}
        <button className="small ghost" onClick={async () => setSt({ ...st, persisted: !!(await navigator.storage.persist?.()) })}>Ask to keep it</button>
      </p>
    );
}

function Data() {
  const [msg, setMsg] = useState('');
  const exportAll = async () => {
    const data = await repo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `writing-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importAll = async (f: File) => {
    try {
      await repo.importAll(JSON.parse(await f.text()));
      await init(true);
      setMsg('✓ Imported.');
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    }
  };
  return (
    <div>
      <p className="muted small">Everything is stored on this device, in this browser. Nothing is sent anywhere except the requests to your AI provider. Export a backup now and then: it's also how you move your stories to another device. API keys are not included.</p>
      <StorageStatus />
      <div className="row">
        <button onClick={exportAll}>Export backup</button>
        <label className="button ghost">Import backup<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
