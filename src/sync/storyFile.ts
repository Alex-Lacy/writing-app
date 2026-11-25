// One story as a file: the chat, its messages, its own Codex and Helper conversations. For
// sharing a single story or moving it by hand; full backups live in Settings, Data.
import { repo } from '../db/db';
import { download, fileName } from '../features/compile';
import { copyOf } from './session';
import { loadUnits, type StoryUnit } from './units';

interface StoryFile { writingStudioStory: 1; exportedAt: number; story: StoryUnit }

export async function saveStoryFile(chatId: string) {
  const u = (await loadUnits()).find((x): x is StoryUnit => x.kind === 'story' && x.id === chatId);
  if (!u) return;
  const file: StoryFile = { writingStudioStory: 1, exportedAt: Date.now(), story: u };
  download(fileName(u.chat.title, 'json').replace(/\.json$/, '.story.json'), JSON.stringify(file), 'application/json');
}

export const isStoryFile = (j: unknown): j is StoryFile => !!j && typeof j === 'object' && (j as StoryFile).writingStudioStory === 1 && !!(j as StoryFile).story?.chat;

/** Adds a story from a file. If this device already has it, `replace` decides: overwrite it, or add a copy. */
export async function importStoryFile(f: StoryFile, replace: (title: string) => boolean): Promise<string> {
  const exists = await repo.get('chats', f.story.chat.id);
  const chats = await repo.all('chats');
  const num = exists?.num ?? Math.max(0, ...chats.map((c) => c.num ?? 0)) + 1;
  const u = exists && !replace(exists.title) ? (copyOf(f.story, 'imported') as StoryUnit) : f.story;
  await repo.replaceStory({ ...u, chat: { ...u.chat, num: u === f.story ? num : Math.max(0, ...chats.map((c) => c.num ?? 0)) + 1 } });
  return u.chat.title;
}
