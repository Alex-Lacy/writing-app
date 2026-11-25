import type { LengthBucket } from './context/length';

// Core data model. Later phases add fields here (marked optional) so stored data stays forward-compatible.

export type Role = 'system' | 'user' | 'assistant';

export interface ProviderConfig {
  id: string;
  name: string;
  /** OpenAI-compatible base URL, e.g. https://api.featherless.ai/v1 */
  baseUrl: string;
  apiKey: string;
  /** Hard context cap imposed by the provider/plan (tokens). */
  contextLimit: number;
}

export interface ModelEntry {
  /** Stable key: `${providerId}::${modelId}` */
  key: string;
  providerId: string;
  modelId: string;
  nickname?: string;
  /** Model's own context window if known; the effective limit is min(this, provider cap). */
  contextLength?: number;
  vision?: boolean;
  tools?: boolean;
  /** 'always': reasons before every reply. 'optional': hybrid model that can think or answer directly. */
  thinking?: 'always' | 'optional';
}

export interface Preset {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface GenParams {
  /** Wire max_tokens. Computed per request (see sendMaxTokens); the stored value is unused. */
  maxTokens: number;
  /** Optional hard cap on one reply in tokens, thinking included. Unset = no cap beyond the context window. */
  hardCap?: number;
  temperature?: number;
  topP?: number;
  minP?: number;
  topK?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** 'system': its own system message. 'inline': bracketed into the next message, for strict templates that reject mid-chat system messages. */
export type SteeringMode = 'system' | 'inline';

export interface WritingSettings {
  enabled: boolean;
  /** NAI-style Background: placed at the top of context, right after the system prompt. */
  background: string;
  /** Steering: inserted `steeringDepth` messages from the end (1 = just before the latest message). */
  steering: string;
  steeringDepth: number;
  steeringMode: SteeringMode;
}

/** Per-chat thinking control, only offered for models that can think. */
export type ThinkingMode = 'default' | 'off' | 'light' | 'deep';

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelKey?: string;
  systemPrompt: string;
  presetId?: string;
  params: GenParams;
  writing: WritingSettings;
  length?: LengthBucket;
  thinking?: ThinkingMode;
  /** Short number shown as #N so people (and Helpers) can refer to a chat. */
  num?: number;
  /** The story's own Codex book (lives and dies with the chat). */
  codexId?: string;
  /** Shared Codex books from the Library attached to this chat. */
  sharedCodexIds?: string[];
  /** Include the Library's Global notes. Default true. */
  globalNotes?: boolean;
  /** Auto-summary of old messages. Default true. */
  autoSummary?: boolean;
  /** Summary parts, oldest first. */
  summary?: SummaryPart[];
  /** Suggested updates: check after this many new words. 0 = off, 1 = after every reply. Default 1500. */
  updatesEvery?: number;
  /** Words written since the last suggested-updates check. */
  wordsSinceCheck?: number;
  /** Last message covered by a suggested-updates check. */
  checkedUpTo?: string;
  /** Whole-story proofread: message id to a fingerprint of the text when it was checked. */
  proofChecked?: Record<string, string>;
  /** Show every new summary part as a card instead of only the first. */
  summaryAlwaysAsk?: boolean;
  /** Style modules (from the Library) switched on for this chat. */
  styleIds?: string[];
  /** Story tags: genre, tone, content notes, sent as one compact line. */
  tags?: string[];
  /** Cliché Filter settings for this chat. */
  filter?: FilterSettings;
}

// ---------- Style modules (reusable instruction blocks, toggled per chat) ----------

export interface StyleModule {
  id: string;
  name: string;
  text: string;
  /** Turned on in new chats. */
  defaultOn?: boolean;
}

// ---------- Codex (keyword-triggered entries) ----------

export interface CodexEntry {
  id: string;
  name: string;
  /** Trigger words; case-insensitive whole-word match. A key wrapped in /…/ is a regex. */
  keys: string[];
  text: string;
  /** Always sent, whether or not a key appears. */
  alwaysOn?: boolean;
  enabled: boolean;
  /** Higher wins when the Codex budget is full. Default 0. */
  priority?: number;
}

export interface CodexBook {
  id: string;
  name: string;
  /** Set for a story's own book; such books are hidden from the Library. */
  chatId?: string;
  /** Library grouping, e.g. a series or world. */
  series?: string;
  archived?: boolean;
  entries: CodexEntry[];
  createdAt: number;
  updatedAt: number;
}

// ---------- Auto-summary ----------

export interface SummaryPart {
  id: string;
  /** Ids of the messages this part covers, oldest first. */
  messageIds: string[];
  text: string;
  /** A covered message was edited after this was written. */
  stale?: boolean;
  /** This part is a merged recap of earlier parts. */
  merged?: boolean;
  createdAt: number;
}

// ---------- Suggestions (every AI-proposed change goes through one of these) ----------

export type SuggestionTarget =
  | { kind: 'system' }
  | { kind: 'title' }
  | { kind: 'background' }
  | { kind: 'steering' }
  | { kind: 'length'; value: string }
  | { kind: 'codex-add'; bookId: string; entry: CodexEntry }
  | { kind: 'codex-edit'; bookId: string; entryId: string; entry: CodexEntry }
  | { kind: 'codex-remove'; bookId: string; entryId: string }
  | { kind: 'summary'; part: SummaryPart; replaces?: string[] }
  | { kind: 'passage'; messageId: string; swipe: number; from: number; to: number }
  | { kind: 'style-add'; module: StyleModule }
  | { kind: 'style-edit'; styleId: string; name: string }
  | { kind: 'style-toggle'; styleId: string; name: string; on: boolean }
  | { kind: 'tags'; tags: string[] };

export interface Suggestion {
  id: string;
  chatId: string;
  /** Who made it. */
  source: 'helper' | 'updates' | 'summary' | 'proofread' | 'rewrite' | 'filter';
  target: SuggestionTarget;
  /** Text before and after (for display; codex entries use their text). */
  before: string;
  after: string;
  /** One line on why. */
  reason?: string;
  status: 'pending' | 'accepted' | 'rejected';
  /** Why it couldn't be applied (the text it changes was edited or removed since). */
  failed?: string;
  /** What to restore on Undo. */
  undo?: unknown;
  createdAt: number;
}

// ---------- Helpers ----------

export interface HelperDef {
  id: string;
  name: string;
  /** One line shown in the picker. */
  blurb: string;
  instructions: string;
  builtIn?: boolean;
  /** May look things up (wikis, and the web if set up). */
  research?: boolean;
}

export interface HelperMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Suggestions this assistant turn produced. */
  suggestionIds?: string[];
  /** A 'tool' message: the lookups that were run, with links. */
  lookups?: { label: string; sources: { title: string; url: string }[] }[];
  createdAt: number;
}

export interface HelperThread {
  id: string;
  chatId: string;
  helperId: string;
  messages: HelperMessage[];
  updatedAt: number;
}

// ---------- Cliché Filter ----------

export type FilterMode = 'off' | 'highlight' | 'suggest' | 'auto';
export interface FilterSettings {
  mode: FilterMode;
  /** Rule ids switched off. */
  disabled?: string[];
  /** Max automatic rewrites per reply in Auto mode. */
  autoLimit?: number;
}

// ---------- Jobs: which model does what ----------

export type Job = 'proofread' | 'helper' | 'updates' | 'summary' | 'filter' | 'rewrite';
/** A model for a job: a model key from "Your models", or providerId::modelId. Unset = default. */
export type JobModels = Partial<Record<Job, string>>;

export interface Attachment {
  // Phase 3: images/files for vision models
  id: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  dataUrl?: string;
  text?: string;
}

export interface Swipe {
  content: string;
  reasoning?: string;
  modelKey?: string;
  createdAt: number;
  finishReason?: string;
  error?: string;
  /** Token counts the server reported for the request that made this version. */
  usage?: { prompt?: number; completion?: number };
}

export interface Message {
  id: string;
  chatId: string;
  /** Sort key within a chat. */
  order: number;
  role: Role;
  /** Alternate versions. User messages normally have one. */
  swipes: Swipe[];
  activeSwipe: number;
  attachments?: Attachment[];
  /** Covered by a summary part, so left out of context (still shown). */
  condensed?: boolean;
}

/** The starting system prompt: a co-writer, not a chatbot. */
export const STORY_PROMPT = `You are a skilled novelist co-writing a story with the user. Continue the story from where it left off, in the established voice, tense and point of view. Write vivid, specific prose with natural dialogue, and let characters act on their own motives. Don't summarise, moralise or wrap things up; end each reply at a natural point that leaves room for what comes next. Don't write the user's own character's words or choices unless asked.`;

export interface AppSettings {
  activeProviderId?: string;
  defaultModelKey?: string;
  defaultParams: GenParams;
  defaultSystemPrompt: string;
  defaultWriting: WritingSettings;
  /** Extra tokens kept free (on top of the reply room) when fitting history; covers estimate error. */
  safetyMargin: number;
  enterToSend: boolean;
  theme: Theme;
  /** Reading settings for story text. */
  storyFontSize?: number;
  storyFont?: 'serif' | 'sans' | 'mono';
  storyLineHeight?: number;
  /** Max width of the story column in px. */
  storyWidth?: number;
  /** Desktop: chat list hidden. */
  sidebarHidden?: boolean;
  /** Size of everything else (buttons, panels), in px. */
  uiFontSize?: number;
  /** Library: notes sent with every chat that has them on. */
  globalNotes?: string;
  /** Optional web search proxy (see worker/README.md); wikis work without it. */
  searchProxy?: string;
  /** Per-job model overrides (Settings, Models, Advanced). */
  jobModels?: JobModels;
  /** Defaults for new chats. */
  defaultUpdatesEvery?: number;
  defaultAutoSummary?: boolean;
  /** Cliché Filter: the person's own rules and word lists, added to the built-in ones. */
  filterRules?: string;
  filterLists?: string;
  /** Style modules in the Library. */
  styles?: StyleModule[];
  /** Custom Helpers, and edited copies of built-in ones (same id). */
  helpers?: HelperDef[];
  /** Learned characters-per-token ratio from real server counts. */
  charsPerToken?: number;
  /** Next chat number. */
  nextChatNum?: number;
  /** One-time data migrations already applied. */
  migrations?: string[];
}

export type Theme = 'dark' | 'light' | 'sepia' | 'black' | 'system';

export const DEFAULT_WRITING: WritingSettings = {
  enabled: false,
  background: '',
  steering: '',
  steeringDepth: 1,
  steeringMode: 'inline',
};

export const DEFAULT_PARAMS: GenParams = { maxTokens: 2048, temperature: 0.8 };

export const DEFAULT_SETTINGS: AppSettings = {
  defaultParams: DEFAULT_PARAMS,
  defaultSystemPrompt: STORY_PROMPT,
  defaultWriting: DEFAULT_WRITING,
  safetyMargin: 256,
  enterToSend: true,
  theme: 'dark',
};

export const FEATHERLESS_PRESET: Omit<ProviderConfig, 'id' | 'apiKey'> = {
  name: 'Featherless',
  baseUrl: 'https://api.featherless.ai/v1',
  contextLimit: 32768,
};

export function activeSwipe(m: Message): Swipe {
  return m.swipes[Math.min(m.activeSwipe, m.swipes.length - 1)] ?? { content: '', createdAt: 0 };
}
