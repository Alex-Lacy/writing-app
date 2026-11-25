// After each reply a quick check asks whether the outline's current beat has been reached and, if
// so, offers a card to move on. (The outline itself, and what it sends, is in context/outline.)
import { parseJson, runJob } from '../ai/jobs';
import { chapterNeedingBeats, chaptersOf, keepPins, parseOutline, setChapterBeats } from '../context/outline';
import { accept, addSuggestions } from '../store/suggestions';
import { replyHooks, updateChat, useStore } from '../store/store';
import { repo } from '../db/db';
import { transcript } from './storyText';

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
  const added = await addSuggestions(chatId, [{
    source: 'updates',
    target: { kind: 'outline-next', from: current },
    before: beats[current],
    after: beats[current + 1] ?? '(end of the outline)',
    reason: r.reason,
  }]);
  // Moving on by itself is the default, so a long outline needs no attention while writing;
  // the card stays in Suggestions, accepted, and Undo there steps back.
  if (now.outline.advance !== 'ask') for (const x of added) await accept(x.id);
}

const PLAN = `You plan the scenes of one chapter of a story, from the story's chapter outline. Write the chapter as a list of scene beats in order: each one scene, one or two plain sentences saying what happens and what it changes (a decision, a reveal, a shift between characters). No prose, dialogue or mood. Usually 3 to 7 beats; follow the chapter's summary and lead naturally into the next chapter without starting it.
The writer's must-have moments for this chapter are listed; include every one of them word for word as its own beat, where it fits in the order, and build the other scenes around them.
Reply with JSON only: ["<beat>", "<beat>", ...]`;

const planning = new Set<string>();

/** Writes out the scenes of the next chapter that only has a heading (and maybe pinned moments). */
export async function planNextChapter(chatId: string, force = false) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const ol = chat?.outline;
  if (!chat || !ol || ol.off || planning.has(chatId)) return false;
  const ch = force ? chaptersOf(ol.text).find((c) => c.open) : chapterNeedingBeats(ol.text);
  if (!ch) return false;
  planning.add(chatId);
  try {
    const all = chatId === useStore.getState().currentChatId ? useStore.getState().messages : await repo.messages(chatId);
    const recent = transcript(all.slice(-6)).slice(-6000);
    const chs = chaptersOf(ol.text);
    const o = parseOutline(ol.text);
    const prev = chs[chs.indexOf(chs.find((c) => c.line === ch.line)!) - 1];
    const res = await runJob({
      job: 'helper',
      chat,
      label: `Planning the scenes of ${ch.title.split(/[:\u2014-]/)[0].trim() || 'the next chapter'}`,
      maxTokens: 1500,
      temperature: 0.6,
      messages: [
        { role: 'system', content: PLAN },
        {
          role: 'user',
          content: [
            `# Chapter outline\n${chs.map((c) => `- ${c.title}`).join('\n')}`,
            chat.writing.background.trim() && `# Background\n${chat.writing.background.trim()}`,
            chat.summary?.length && `# Story so far\n${chat.summary.map((p) => p.text).join('\n\n')}`,
            prev?.beats.length && `# Scenes of the previous chapter (${prev.title})\n${prev.beats.map((i) => `- ${o.beats[i]}`).join('\n')}`,
            recent && `# Most recent story\n${recent}`,
            `# Chapter to plan\n${ch.title}`,
            `# Must-have moments in it\n${ch.pins.length ? ch.pins.map((p) => `- ${p}`).join('\n') : '(none)'}`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });
    const beats = parseJson<unknown[]>(res.text);
    const written = Array.isArray(beats) ? beats.filter((b): b is string => typeof b === 'string' && !!b.trim()) : [];
    if (!written.length) return false;
    // The outline may have been edited meanwhile: apply to the chapter as it stands now.
    const now = useStore.getState().chats.find((c) => c.id === chatId)?.outline;
    const still = now && chaptersOf(now.text).find((c) => c.title === ch.title && c.open);
    if (!now || !still) return false;
    await updateChat({ outline: { ...now, text: setChapterBeats(now.text, still, keepPins(written, still.pins)) } }, chatId);
    return true;
  } finally {
    planning.delete(chatId);
  }
}

replyHooks.push(async ({ chatId, newText }) => {
  await checkBeat(chatId, newText);
  await planNextChapter(chatId);
});
