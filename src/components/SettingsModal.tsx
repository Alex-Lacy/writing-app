import { useMemo, useState } from 'react';
import { repo } from '../db/db';
import { uid } from '../lib/id';
import { listModels, type RemoteModel } from '../providers/openai';
import {
  deleteModel, deletePreset, deleteProvider, init, modelLabel, saveSettings, ui, upsertModel, upsertPreset, upsertProvider, useStore,
} from '../store/store';
import type { ProviderConfig } from '../types';

type Tab = 'providers' | 'models' | 'presets' | 'general' | 'data';

export function SettingsModal() {
  const [tab, setTab] = useState<Tab>('providers');
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
      const list = await listModels(p);
      setStatus((s) => ({ ...s, [p.id]: `✓ Connected, ${list.length.toLocaleString()} models available` }));
    } catch (e) {
      setStatus((s) => ({ ...s, [p.id]: `✗ ${(e as Error).message}` }));
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

  const fetchList = async () => {
    if (!provider) return;
    setBusy('Loading…');
    try {
      setRemote(await listModels(provider));
      setBusy('');
    } catch (e) {
      setBusy(`✗ ${(e as Error).message}`);
    }
  };
  const filtered = useMemo(() => {
    if (!remote) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return remote.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t))).slice(0, 200);
  }, [remote, q]);
  const add = (modelId: string, contextLength?: number, vision?: boolean) => {
    if (!provider) return;
    upsertModel({ key: `${provider.id}::${modelId}`, providerId: provider.id, modelId, contextLength, vision });
  };

  return (
    <div>
      <h3>Your models</h3>
      {models.length === 0 && <p className="muted small">None yet. Fetch the list below and add a few.</p>}
      {models.map((m) => (
        <div key={m.key} className="model-row">
          <input className="nick" value={m.nickname ?? ''} placeholder={modelLabel({ ...m, nickname: undefined })} onChange={(e) => upsertModel({ ...m, nickname: e.target.value || undefined })} title="Nickname" />
          <span className="muted small model-id" title={m.modelId}>{m.modelId} · {providers.find((p) => p.id === m.providerId)?.name}</span>
          <input className="ctx" type="number" value={m.contextLength ?? ''} placeholder="ctx" title="Model context length (optional)" onChange={(e) => upsertModel({ ...m, contextLength: e.target.value ? Number(e.target.value) : undefined })} />
          <label className="small" title="Default model for new chats"><input type="radio" checked={defaultKey === m.key} onChange={() => saveSettings({ defaultModelKey: m.key })} /> default</label>
          <button className="icon" onClick={() => deleteModel(m.key)} title="Remove">✕</button>
        </div>
      ))}

      <h3>Add from provider</h3>
      <div className="row">
        <select value={pid} onChange={(e) => { setPid(e.target.value); setRemote(null); }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={fetchList}>Fetch model list</button>
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
                  <span className="muted small">{m.vision ? '👁 ' : ''}{m.contextLength ? `${Math.round(m.contextLength / 1024)}k` : ''} {m.description ?? ''}</span>
                  <button className="small" disabled={added} onClick={() => add(m.id, m.contextLength, m.vision)}>{added ? 'Added' : 'Add'}</button>
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
    </div>
  );
}

function Presets() {
  const presets = useStore((s) => s.presets);
  return (
    <div>
      <p className="muted small">Saved system prompts. Pick one per chat from the chat settings panel.</p>
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
      <label className="field"><span>Default system prompt for new chats</span>
        <textarea rows={4} value={s.defaultSystemPrompt} onChange={(e) => saveSettings({ defaultSystemPrompt: e.target.value })} />
      </label>
      <label className="switch"><input type="checkbox" checked={s.enterToSend} onChange={(e) => saveSettings({ enterToSend: e.target.checked })} /> Enter sends (Shift+Enter for newline; always off on touch screens)</label>
      <label className="switch"><input type="checkbox" checked={s.defaultWriting.enabled} onChange={(e) => saveSettings({ defaultWriting: { ...s.defaultWriting, enabled: e.target.checked } })} /> Writing tools on by default for new chats</label>
      <label className="field num"><span>Context safety margin (tokens)</span>
        <input type="number" value={s.safetyMargin} onChange={(e) => saveSettings({ safetyMargin: Math.max(0, Number(e.target.value) || 0) })} />
      </label>
      <label className="field num"><span>Theme</span>
        <select value={s.theme} onChange={(e) => saveSettings({ theme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">Dark</option><option value="light">Light</option>
        </select>
      </label>
    </div>
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
      <p className="muted small">Everything is stored locally in this browser. Back up regularly until sync arrives. API keys are not included in exports.</p>
      <div className="row">
        <button onClick={exportAll}>Export backup</button>
        <label className="button ghost">Import backup<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
