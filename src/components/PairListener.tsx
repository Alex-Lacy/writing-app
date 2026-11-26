import { useEffect, useState } from 'react';
import { waitForKnock } from '../sync/link';
import { listPairs, me, onPairsChanged, type Pair } from '../sync/session';
import { ui, useStore } from '../store/store';
import { useIncoming } from '../sync/incoming';


/** While the app is open, listens for paired devices asking to sync. */
export function PairListener() {
  const pipeOff = useStore((s) => !!s.settings.syncPipeOff);
  const pipe = useStore((s) => s.settings.syncPipe ?? '');
  const [pairs, setPairs] = useState<Pair[]>([]);
  useEffect(() => {
    const load = () => void listPairs().then(setPairs);
    load();
    return onPairsChanged(load);
  }, []);
  const ids = pairs.map((p) => `${p.peerId}:${p.secret}`).join(',');
  useEffect(() => {
    if (pipeOff || !pairs.length) return;
    const stop = new AbortController();
    void me().then(({ deviceId }) => {
      for (const pair of pairs) {
        void (async () => {
          while (!stop.signal.aborted) {
            const session = await waitForKnock(pair.secret, deviceId, pair.peerId, { pipe, signal: stop.signal }).catch(() => undefined);
            if (!session) return;
            useIncoming.setState({ knock: { pair, session, at: Date.now() } });
            ui.openSync(true);
          }
        })();
      }
    });
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, pipeOff, pipe]);
  return null;
}
