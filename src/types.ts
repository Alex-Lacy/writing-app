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
  /** Room always kept free for the reply when fitting history. */
  maxTokens: number;
  /** Let the reply use all remaining context instead of stopping at maxTokens (default on). Needed for thinking models, whose reasoning counts against the limit. */
  autoMaxTokens?: boolean;
  temperature?: number;
  topP?: number;
  minP?: number;
  topK?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** 'system': its own system message. 'inline': bracketed into the next message, for strict templates that reject mid-chat system messages. */
export type AuthorsNoteRole = 'system' | 'inline';

export interface WritingSettings {
  enabled: boolean;
  /** NAI-style Memory: placed at the top of context, right after the system prompt. */
  memory: string;
  /** Author's Note: inserted `anDepth` messages from the end (1 = just before the latest message). */
  authorsNote: string;
  anDepth: number;
  anRole: AuthorsNoteRole;
  // Phase 2: lorebookId?: string; condense?: CondenseSettings; slopSlayer?: SlopSettings
}

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
  // Phase 2: summary?: string (condensed history)
}

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
  /** Phase 2: excluded from context after condensing. */
  condensed?: boolean;
}

export interface AppSettings {
  activeProviderId?: string;
  defaultModelKey?: string;
  defaultParams: GenParams;
  defaultSystemPrompt: string;
  defaultWriting: WritingSettings;
  /** Tokens kept free on top of maxTokens when fitting history. */
  safetyMargin: number;
  enterToSend: boolean;
  theme: 'dark' | 'light';
}

export const DEFAULT_WRITING: WritingSettings = {
  enabled: false,
  memory: '',
  authorsNote: '',
  anDepth: 1,
  anRole: 'system',
};

export const DEFAULT_PARAMS: GenParams = { maxTokens: 2048, autoMaxTokens: true, temperature: 0.8 };

export const DEFAULT_SETTINGS: AppSettings = {
  defaultParams: DEFAULT_PARAMS,
  defaultSystemPrompt: 'You are a helpful assistant.',
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
