import { useCallback, useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { cleanCode, connect, newCode, shareLocalAddress, SIGNAL_DEFAULT, type ConnectError, type Link } from '../sync/link';
import { guestServe, hostApply, hostCancel, hostReview, lastSnapshotAt, undoLastSync, type Choice } from '../sync/session';
import { saveSettings, ui, useStore } from '../store/store';

type Review = Awaited<ReturnType<typeof hostReview>>;
type Stage =
  | { k: 'start' }
  | { k: 'host'; code: string; status: string }
  | { k: 'guest'; status: string }
  | { k: 'review'; r: Review }
  | { k: 'applying' }
  | { k: 'done'; summary: string }
  | { k: 'error'; message: string; details?: string; noLocal?: boolean };

/** The code in a pairing link (the QR code opens the app with #pair=CODE). */
const pairFromUrl = () => location.hash.match(/pair=([A-Z0-9-]+)/i)?.[1];

/** Sync with your other device: one shows a code, the other scans or types it. */
export function SyncModal() {
  const relay = useStore((s) => s.settings.syncRelay ?? '');
  const turn = useStore((s) => s.settings.syncTurn);
  const [shared, setShared] = useState('');
  const current = useStore((s) => s.currentChatId);
  const [stage, setStage] = useState<Stage>({ k: 'start' });
  const [typed, setTyped] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [only, setOnly] = useState(false);
  const [snapAt, setSnapAt] = useState<number>();
  const link = useRef<Link>(undefined);
  const abort = useRef<AbortController>(undefined);


  const fail = useCallback((e: unknown) => {
    if ((e as Error).name === 'AbortError') return;
    setStage({ k: 'error', message: (e as Error).message, details: (e as ConnectError).details, noLocal: (e as ConnectError).noLocal });
  }, []);

  const host = async () => {
    const code = newCode();
    abort.current = new AbortController();
    setStage({ k: 'host', code, status: 'Getting ready…' });
    try {
      link.current = await connect(code, 'host', { relay, turn, signal: abort.current.signal, onStatus: (status) => setStage({ k: 'host', code, status }) });
      setStage({ k: 'host', code, status: 'Connected. Comparing stories…' });
      const r = await hostReview(link.current);
      setChoices({});
      setStage({ k: 'review', r });
    } catch (e) {
      fail(e);
    }
  };

  const join = useCallback(async (code: string) => {
    if (cleanCode(code).length < 10) return;
    abort.current = new AbortController();
    setStage({ k: 'guest', status: 'Looking for the other device…' });
    try {
      link.current = await connect(code, 'guest', { relay, turn, signal: abort.current.signal, onStatus: (status) => setStage({ k: 'guest', status }) });
      const summary = await guestServe(link.current, (status) => setStage({ k: 'guest', status }));
      setStage({ k: 'done', summary });
    } catch (e) {
      fail(e);
    }
  }, [relay, turn, fail]);

  // Opened from a scanned pairing link: join straight away (once).
  const autoJoin = useRef(pairFromUrl());
  useEffect(() => {
    void lastSnapshotAt().then(setSnapAt);
  }, []);
  useEffect(() => {
    const code = autoJoin.current;
    autoJoin.current = undefined;
    if (code) {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => void join(code), 0);
    }
  }, [join]);
  useEffect(() => () => {
    abort.current?.abort();
    link.current?.close();
  }, []);

  const apply = async (r: Review) => {
    setStage({ k: 'applying' });
    try {
      const summary = await hostApply(link.current!, r, choices, only ? current : undefined);
      setStage({ k: 'done', summary });
    } catch (e) {
      fail(e);
    }
  };

  const close = () => {
    if (stage.k === 'review' && link.current) void hostCancel(link.current);
    ui.openSync(false);
  };

  return (
    <div className="modal-scrim" onClick={close}>
      <div className="modal sync" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Sync with another device</h2>
          <button className="icon" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          {stage.k === 'start' && (
            <>
              <p className="muted small">
                Copies stories and shared Codex books between your phone and computer, straight from one device to the other.
                Your stories never go through a server: the two devices only swap a short, encrypted connection note to find each other.
                Both need this app open, ideally on the same Wi-Fi. API keys and settings stay on each device.
              </p>
              <div className="sync-start">
                <div className="card">
                  <b>Show a code here</b>
                  <p className="muted small">Then scan it with the other device's camera, or type the code in.</p>
                  <button className="primary" onClick={() => void host()}>Show code</button>
                </div>
                <div className="card">
                  <b>Enter the code from the other device</b>
                  <div className="row">
                    <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XX" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                    <button disabled={cleanCode(typed).length < 10} onClick={() => void join(typed)}>Connect</button>
                  </div>
                  <Scanner onCode={(c) => void join(c)} />
                </div>
              </div>
              {snapAt && (
                <p className="small muted">
                  Last sync on this device: {new Date(snapAt).toLocaleString()}.{' '}
                  <button className="small ghost" onClick={async () => confirm('Put every story back exactly as it was before the last sync on this device?') && (await undoLastSync()) && (setSnapAt(undefined), setStage({ k: 'done', summary: 'Undone: stories are back as they were before the last sync.' }))}>Undo it</button>
                </p>
              )}
              <details className="muted small">
                <summary>Advanced: pairing relay</summary>
                <p>The two devices find each other through a free public relay ({SIGNAL_DEFAULT}). It only ever carries an encrypted connection note. You can use your own ntfy server instead.</p>
                <input value={relay} placeholder={SIGNAL_DEFAULT} onChange={(e) => void saveSettings({ syncRelay: e.target.value.trim() || undefined })} />
                <p>If your devices can't reach each other directly (different networks, or a router that keeps devices apart), a TURN relay can pass the encrypted connection between them. Services such as Metered or Cloudflare offer free ones; paste the details here on both devices.</p>
                <div className="grid3">
                  <input aria-label="TURN address" placeholder="turn:relay.example.com:3478" value={turn?.urls ?? ''} onChange={(e) => void saveSettings({ syncTurn: e.target.value.trim() ? { ...turn, urls: e.target.value.trim() } : undefined })} />
                  <input aria-label="TURN username" placeholder="Username" value={turn?.username ?? ''} disabled={!turn?.urls} onChange={(e) => turn && void saveSettings({ syncTurn: { ...turn, username: e.target.value } })} />
                  <input aria-label="TURN password" placeholder="Password" type="password" value={turn?.credential ?? ''} disabled={!turn?.urls} onChange={(e) => turn && void saveSettings({ syncTurn: { ...turn, credential: e.target.value } })} />
                </div>
              </details>
            </>
          )}

          {stage.k === 'host' && (
            <div className="sync-code">
              <Qr text={`${location.origin}${location.pathname}#pair=${stage.code}`} />
              <p className="code">{stage.code}</p>
              <p className="muted small">On your other device, open Writing Studio, choose Sync, and type this code (or scan it with the camera). The code works once.</p>
              <p className="small"><span className="spinner" /> {stage.status}</p>
            </div>
          )}

          {stage.k === 'guest' && <p className="small"><span className="spinner" /> {stage.status}</p>}
          {stage.k === 'applying' && <p className="small"><span className="spinner" /> Syncing…</p>}

          {stage.k === 'review' && <ReviewList r={stage.r} choices={choices} setChoices={setChoices} only={only} setOnly={setOnly} current={current} onApply={() => void apply(stage.r)} onCancel={close} />}

          {stage.k === 'done' && (
            <>
              <p>{stage.summary}</p>
              <p className="muted small">A copy of everything from before this sync was saved on this device; "Undo it" in Sync puts it back.</p>
              <button className="primary" onClick={() => ui.openSync(false)}>Close</button>
            </>
          )}
          {stage.k === 'error' && (
            <>
              <p className="error">{stage.message}</p>
              {stage.details && <pre className="small muted sync-details">{stage.details}</pre>}
              <div className="row">
                {stage.noLocal && !!navigator.mediaDevices?.getUserMedia && (
                  <button onClick={() => shareLocalAddress().then(() => setShared('Done. Now start the sync again on both devices.'), () => setShared("The camera wasn't allowed, so the Wi-Fi address stays hidden."))}>Share Wi-Fi address</button>
                )}
                <button onClick={() => { setShared(''); setStage({ k: 'start' }); }}>Try again</button>
              </div>
              {shared && <p className="small">{shared}</p>}
              {stage.noLocal && <p className="muted small">Sharing the address asks to use the camera, then turns it straight off: nothing is recorded. Browsers only reveal a device's Wi-Fi address to pages allowed to use the camera.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const STEP_LABEL: Record<string, string> = {
  take: '← Copy here',
  give: '→ Send there',
  'delete-here': '✕ Delete here',
  'delete-there': '✕ Delete there',
};

function ReviewList({ r, choices, setChoices, only, setOnly, current, onApply, onCancel }: {
  r: Review; choices: Record<string, Choice>; setChoices: (c: Record<string, Choice>) => void; only: boolean; setOnly: (v: boolean) => void; current?: string; onApply: () => void; onCancel: () => void;
}) {
  const shown = r.items.filter((x) => !only || x.id === current);
  const conflicts = shown.filter((x) => x.step === 'conflict');
  const missing = conflicts.filter((x) => !choices[x.id]).length;
  const hasCurrent = r.items.some((x) => x.id === current);
  return (
    <>
      <p className="small">Connected to <b>{r.peer}</b>. {r.items.length ? 'Here is what will change:' : 'Both devices already match.'}</p>
      {hasCurrent && r.items.length > 1 && (
        <label className="switch small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only the story that's open</label>
      )}
      {shown.length > 0 && <div className="sync-list">
        {shown.filter((x) => x.step !== 'conflict').map((x) => (
          <div key={x.id} className="sync-item">
            <span className="sync-step">{STEP_LABEL[x.step]}</span>
            <span className="grow">{x.title} <span className="muted small">· {x.why}</span></span>
          </div>
        ))}
        {conflicts.map((x) => (
          <div key={x.id} className="sync-item conflict">
            <div><b>⚠ {x.title}</b> <span className="muted small">· {x.why}</span></div>
            {x.here?.words !== undefined && x.there?.words !== undefined && (
              <p className="muted small">This device: {x.here.words.toLocaleString()} words, edited {new Date(x.here.updatedAt).toLocaleString()}. Other device: {x.there.words.toLocaleString()} words, edited {new Date(x.there.updatedAt).toLocaleString()}.</p>
            )}
            <div className="row small">
              {(['both', 'here', 'there'] as Choice[]).map((c) => (
                <label key={c} className="switch">
                  <input type="radio" name={x.id} checked={choices[x.id] === c} onChange={() => setChoices({ ...choices, [x.id]: c })} />
                  {c === 'both' ? 'Keep both (the other as a copy)' : c === 'here' ? (x.here ? "Keep this device's" : 'Delete it') : x.there ? "Keep the other device's" : 'Delete it'}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>}
      <div className="row">
        <button className="primary" disabled={missing > 0} onClick={onApply}>{shown.length ? 'Sync now' : 'Done'}</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
        {missing > 0 && <span className="muted small">Choose what to keep for {missing} stor{missing === 1 ? 'y' : 'ies'} first.</span>}
      </div>
      <p className="muted small">Both devices save a copy of everything first, so a sync can be undone.</p>
    </>
  );
}

function Qr({ text }: { text: string }) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return <div className="qr" dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }) }} />;
}

/** Scans a pairing QR code with the camera, where the browser can read QR codes itself. */
function Scanner({ onCode }: { onCode: (c: string) => void }) {
  const [on, setOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | undefined;
    let stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const found = await det.detect(video.current).catch(() => []);
          const code = found.map((f) => f.rawValue.match(/pair=([A-Z0-9-]+)/i)?.[1]).find(Boolean);
          if (code) {
            setOn(false);
            onCode(code);
            return;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch {
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, onCode]);
  if (!supported) return null;
  return on ? <video ref={video} className="scanner" muted playsInline /> : <button className="small ghost" onClick={() => setOn(true)}>Scan with camera</button>;
}
