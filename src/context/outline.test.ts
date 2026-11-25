import { describe, expect, it } from 'vitest';
import { chapterNeedingBeats, chaptersOf, keepPins, moveMarker, outlineBlocks, parseOutline, setChapterBeats } from './outline';
import type { Chat } from '../types';

const text = '1. Mara arrives.\n> Rell offers a job.\n- The job goes wrong.\nThe betrayal.';
const chat = (o: Chat['outline']) => ({ outline: o, writing: { steeringDepth: 1, steeringMode: 'inline' } }) as unknown as Chat;

describe('outline', () => {
  it('reads beats and the marker, ignoring list numbering', () => {
    expect(parseOutline(text)).toMatchObject({ beats: ['Mara arrives.', 'Rell offers a job.', 'The job goes wrong.', 'The betrayal.'], current: 1 });
    expect(parseOutline('A\nB').current).toBe(0);
  });
  it('moves the marker and marks the end', () => {
    const t = moveMarker(text, 1);
    expect(parseOutline(t).current).toBe(2);
    expect(t).toContain('> - The job goes wrong.');
    expect(t).toContain('1. Mara arrives.');
    const end = moveMarker(moveMarker(t, 1), 1);
    expect(end.endsWith('> (end)')).toBe(true);
    expect(parseOutline(end)).toMatchObject({ current: 4 });
    expect(parseOutline(moveMarker(end, -1)).current).toBe(3);
  });
  it('sends the current beat near the reply and the next ones near the top, never finished ones', () => {
    const b = outlineBlocks(chat({ text }));
    expect(b.map((x) => x.id)).toEqual(['outline-ahead', 'outline-now']);
    expect(b[1].text).toContain('Rell offers a job.');
    expect(b[0].text).toContain('The job goes wrong. Then: The betrayal.');
    expect(b[0].text).toMatch(/Don't steer toward these/);
    expect(b.map((x) => x.text).join()).not.toContain('Mara arrives');
    expect(outlineBlocks(chat({ text, ahead: 0 })).map((x) => x.id)).toEqual(['outline-now']);
    expect(outlineBlocks(chat({ text, off: true }))).toEqual([]);
    expect(outlineBlocks(chat({ text: moveMarker(moveMarker(moveMarker(text, 1), 1), 1) }))).toEqual([]);
  });
  it('chapter headings orient the model but are not beats, and survive moving the marker', () => {
    const t = '# Chapter 1: Arrival\nMara arrives.\n> Rell offers a job.\n\n# Chapter 2: The docks\nThe job goes wrong.';
    expect(parseOutline(t)).toMatchObject({ beats: ['Mara arrives.', 'Rell offers a job.', 'The job goes wrong.'], current: 1, chapters: ['Chapter 1: Arrival', 'Chapter 1: Arrival', 'Chapter 2: The docks'] });
    const b = Object.fromEntries(outlineBlocks(chat({ text: t })).map((x) => [x.id, x.text]));
    expect(b['outline-now']).toContain('Current chapter: Chapter 1: Arrival. Current scene goal: Rell offers a job.');
    expect(b['outline-ahead']).toContain('(Chapter 2: The docks) The job goes wrong.');
    const moved = moveMarker(t, 1);
    expect(moved).toBe('# Chapter 1: Arrival\nMara arrives.\nRell offers a job.\n\n# Chapter 2: The docks\n> The job goes wrong.');
  });
  it('chapters with only "!" moments are planned when the story nears them, keeping the moments', () => {
    const t = "# Ch 1: Arrival\nMara arrives.\n> Rell offers a job.\n\n# Ch 2: Docks. It goes wrong.\n! Rell's ship leaves without her.\n\n# Ch 3: Betrayal";
    const chs = chaptersOf(t);
    expect(chs.map((c) => [c.title, c.open, c.pins])).toEqual([['Ch 1: Arrival', false, []], ['Ch 2: Docks. It goes wrong.', true, ["Rell's ship leaves without her."]], ['Ch 3: Betrayal', true, []]]);
    expect(chapterNeedingBeats(t)?.title).toBe('Ch 2: Docks. It goes wrong.');
    expect(chapterNeedingBeats(t.replace('> Rell', 'Rell').replace('Mara arrives.', '> Mara arrives.'))).toBeUndefined();
    // The model reworded the moment and forgot nothing else: the writer's words win.
    const beats = keepPins(['The job at the docks starts.', "Rell's ship leaves without Mara.", 'Mara is seen.'], chs[1].pins);
    expect(beats).toEqual(['The job at the docks starts.', "! Rell's ship leaves without her.", 'Mara is seen.']);
    expect(keepPins(['A.', 'B.'], ['Pinned moment.'])).toEqual(['! Pinned moment.', 'A.', 'B.']);
    const after = setChapterBeats(t, chs[1], beats);
    expect(after).toBe("# Ch 1: Arrival\nMara arrives.\n> Rell offers a job.\n\n# Ch 2: Docks. It goes wrong.\nThe job at the docks starts.\n! Rell's ship leaves without her.\nMara is seen.\n\n# Ch 3: Betrayal");
    expect(parseOutline(after).beats[3]).toBe("Rell's ship leaves without her.");
    // Ran out of beats: the new chapter's first scene becomes current.
    const ended = moveMarker(moveMarker(after, 9), 0);
    const ch3 = chaptersOf(ended)[2];
    const next = setChapterBeats(ended, ch3, ['Mara confronts Rell.']);
    expect(next.endsWith('# Ch 3: Betrayal\n> Mara confronts Rell.')).toBe(true);
    expect(next).not.toContain('(end)');
  });
  it('sends the chapter list for orientation', () => {
    const t = '# Ch 1: Arrival\nMara arrives.\n> Rell offers a job.\n# Ch 2: Docks';
    const b = outlineBlocks(chat({ text: t }));
    expect(b[0].id).toBe('outline-chapters');
    expect(b[0].text).toContain('- Ch 1: Arrival (current chapter)\n- Ch 2: Docks');
  });
});
