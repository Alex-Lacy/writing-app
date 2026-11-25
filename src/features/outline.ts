// After each reply a quick check asks whether the outline's current beat has been reached and, if
// so, offers a card to move on. (The outline itself, and what it sends, is in context/outline.)
import { parseJson, runJob } from '../ai/jobs';
import { parseOutline } from '../context/outline';
import { addSuggestions } from '../store/suggestions';
import { replyHooks, useStore } from '../store/store';

const CHECK = `You track a story's progress against its outline. Given the current beat and the newest story text, decide if the beat has now happened in the story (its main event or goal is reached), not just been approached or set up.
Reply with JSON only: {"reached":true|false,"reason":"<a few words>"}`;

/** After each reply: has the current beat been reached? If so, a card offers to move on. */
export async function checkBeat(chatId: string, newText: string) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const ol = chat?.outline;
  if (!chat || !ol || ol.off || ol.check === false) return;
  const { beats, current } = parseOutline(ol.text);
  if (current >= beats.length) return;
  // One card at a time.
  if (useStore.getState().suggestions.some((x) => x.chatId === chatId && x.status === 'pending' && x.target.kind === 'outline-next')) return;
  const res = await runJob({
    job: 'updates',
    chat,
    label: 'Checking the outline',
    maxTokens: 200,
    temperature: 0.1,
    messages: [
      { role: 'system', content: CHECK },
      { role: 'user', content: `# Current beat\n${beats[current]}\n\n# Newest story text\n${newText.slice(-6000)}` },
    ],
  });
  const r = parseJson<{ reached?: boolean; reason?: string }>(res.text);
  if (!r?.reached) return;
  const now = useStore.getState().chats.find((c) => c.id === chatId);
  if (!now?.outline || parseOutline(now.outline.text).current !== current) return;
  await addSuggestions(chatId, [{
    source: 'updates',
    target: { kind: 'outline-next', from: current },
    before: beats[current],
    after: beats[current + 1] ?? '(end of the outline)',
    reason: r.reason,
  }]);
}

replyHooks.push(async ({ chatId, newText }) => checkBeat(chatId, newText));
