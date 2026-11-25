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
  /** Extra tokens kept free (on top of the reply room) when fitting history; covers estimate error. */
  safetyMargin: number;
  enterToSend: boolean;
  theme: 'dark' | 'light';
  /** One-time data migrations already applied. */
  migrations?: string[];
}

export const DEFAULT_WRITING: WritingSettings = {
  enabled: false,
  memory: '',
  authorsNote: '',
  anDepth: 1,
  anRole: 'inline',
};

export const DEFAULT_PARAMS: GenParams = { maxTokens: 2048, temperature: 0.8 };

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
