import { describe, expect, it } from 'vitest';
import { moveMarker, outlineBlocks, parseOutline } from './outline';
import type { Chat } from '../types';

const text = '1. Mara arrives.\n> Rell offers a job.\n- The job goes wrong.\nThe betrayal.';
const chat = (o: Chat['outline']) => ({ outline: o, writing: { steeringDepth: 1, steeringMode: 'inline' } }) as unknown as Chat;

describe('outline', () => {
  it('reads beats and the marker, ignoring list numbering', () => {
    expect(parseOutline(text)).toEqual({ beats: ['Mara arrives.', 'Rell offers a job.', 'The job goes wrong.', 'The betrayal.'], current: 1 });
    expect(parseOutline('A\nB').current).toBe(0);
  });
  it('moves the marker and marks the end', () => {
    const t = moveMarker(text, 1);
    expect(parseOutline(t).current).toBe(2);
    expect(t).toContain('> The job goes wrong.');
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
});
