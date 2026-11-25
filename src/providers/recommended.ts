// Curated one-click models per provider.
//
// Featherless list reviewed Nov 2026. Model IDs, context sizes, tool-use and vision flags and
// concurrency cost come from Featherless's live /models data. Quality picks draw on EQ-Bench
// Creative Writing v3, AI Roleplay Bench (Sep 2026), Featherless's own "best for creative
// writing" guide, and OpenRouter roleplay usage. Thinking behaviour is from each model family's
// documentation and reviews (Featherless doesn't report it). Gated models are left out.

export interface RecommendedModel {
  id: string;
  nickname: string;
  group: string;
  note: string;
  contextLength?: number;
  vision?: boolean;
  tools?: boolean;
  thinking?: 'always' | 'optional';
  /** Featherless concurrency units per request: 1 small, 2 medium, 4 large. */
  cost?: number;
}

const TOP = 'Best writers (flagship models)';
const UNC = 'Uncensored creative (fiction and roleplay fine-tunes)';
const FAST = 'Small and fast';
const GEN = 'General, reasoning, vision and tools';

export const RECOMMENDED_FEATHERLESS: RecommendedModel[] = [
  // Flagships. These rank highest on creative-writing and roleplay benchmarks.
  { group: TOP, id: 'moonshotai/Kimi-K3', nickname: 'Kimi K3', note: '#1 on AI Roleplay Bench. Elegant, rhythmic prose; characters hold their ground. A little cautious with explicit scenes.', contextLength: 262144, vision: true, tools: true, thinking: 'always', cost: 4 },
  { group: TOP, id: 'zai-org/GLM-5.3', nickname: 'GLM 5.3', note: 'Best open model for prose and long-story consistency; natural dialogue, few clichés. Stricter about explicit romance than older GLMs.', contextLength: 262144, tools: true, thinking: 'always', cost: 4 },
  { group: TOP, id: 'moonshotai/Kimi-K2.6', nickname: 'Kimi K2.6', note: 'Top open-weight model on EQ-Bench Creative Writing. Vivid and literary.', contextLength: 262144, vision: true, tools: true, thinking: 'optional', cost: 4 },
  { group: TOP, id: 'deepseek-ai/DeepSeek-V4-Pro-0813', nickname: 'DeepSeek V4 Pro', note: "DeepSeek's strongest model on Featherless (Aug 2026 update; there's no V4.1 Pro here yet). Smart, steady storyteller.", contextLength: 262144, thinking: 'optional', cost: 4 },
  { group: TOP, id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', nickname: 'DeepSeek V4.1 Flash', note: 'Near the top of roleplay rankings and the most-used roleplay model on OpenRouter. Fast and good value.', contextLength: 262144, thinking: 'optional', cost: 4 },
  { group: TOP, id: 'zai-org/GLM-5.3-Flash', nickname: 'GLM 5.3 Flash', note: 'Cheaper GLM 5.3: strong dialogue and keeps the story moving. Great for drafting.', contextLength: 262144, vision: true, tools: true, thinking: 'always', cost: 4 },

  // Fine-tunes trained for fiction. Far more willing with mature and dark material than the flagships.
  { group: UNC, id: 'TheDrummer/Artemis-31B-v1.2', nickname: 'Artemis 31B', note: "TheDrummer's latest (Gemma 4 based). Creative and willing, with good instruction following.", contextLength: 32768, vision: true, tools: true, cost: 2 },
  { group: UNC, id: 'sophosympatheia/Glistening-Gem-31B-v2.2', nickname: 'Glistening Gem 31B', note: 'Literary prose merge from the Midnight Miqu author; rich descriptions.', contextLength: 32768, vision: true, tools: true, cost: 2 },
  { group: UNC, id: 'zerofata/G4-LuneLight-31B', nickname: 'LuneLight 31B', note: 'New Gemma 4 roleplay tune; expressive and character-driven.', contextLength: 32768, vision: true, tools: true, cost: 2 },
  { group: UNC, id: 'LatitudeGames/Equinox-31B', nickname: 'Equinox 31B', note: 'From the AI Dungeon team. Adventure fiction that lets things go wrong.', contextLength: 32768, vision: true, tools: true, cost: 2 },
  { group: UNC, id: 'huihui-ai/Huihui-Qwen3.8-27B-abliterated', nickname: 'Qwen 3.8 27B Uncensored', note: 'Smart modern base with refusals removed. Follows complex instructions; less flowery prose.', contextLength: 32768, vision: true, tools: true, thinking: 'optional', cost: 2 },
  { group: UNC, id: 'TheDrummer/Cydonia-24B-v4.1', nickname: 'Cydonia 24B', note: 'Proven favourite for stories and roleplay.', contextLength: 32768, tools: true, cost: 2 },
  { group: UNC, id: 'Sao10K/L3.3-70B-Euryale-v2.3', nickname: 'Euryale 70B', note: 'Classic 70B storyteller: rich, descriptive and willing. Older but still loved.', contextLength: 32768, tools: true, cost: 4 },
  { group: UNC, id: 'TheDrummer/Anubis-70B-v1.2', nickname: 'Anubis 70B', note: 'Strong character voice and dialogue.', contextLength: 32768, tools: true, cost: 4 },

  // Cheap on concurrency (1 unit). Good for quick drafting and on smaller plans.
  { group: FAST, id: 'TheDrummer/Rocinante-X-12B-v1', nickname: 'Rocinante X 12B', note: 'Newest Rocinante: vivid storytelling, very willing.', contextLength: 32768, tools: true, cost: 1 },
  { group: FAST, id: 'inflatebot/MN-12B-Mag-Mell-R1', nickname: 'Mag Mell 12B', note: 'Best-loved small creative model; imaginative.', contextLength: 32768, tools: true, cost: 1 },
  { group: FAST, id: 'LatitudeGames/Muse-12B', nickname: 'Muse 12B', note: 'Long-form narrative with emotional depth.', contextLength: 32768, tools: true, cost: 1 },
  { group: FAST, id: 'Qwen/Qwen3.5-9B', nickname: 'Qwen 3.5 9B', note: 'Small general assistant that can also read images.', contextLength: 32768, vision: true, tools: true, thinking: 'optional', cost: 1 },

  // General purpose.
  { group: GEN, id: 'Qwen/Qwen3.8-27B', nickname: 'Qwen 3.8 27B', note: 'Fast all-rounder, excellent at following style rules; reads images.', contextLength: 262144, vision: true, tools: true, thinking: 'optional', cost: 2 },
  { group: GEN, id: 'google/gemma-4-31B-it', nickname: 'Gemma 4 31B', note: 'Strong short-form prose for its size; reads images.', contextLength: 262144, vision: true, tools: true, cost: 2 },
  { group: GEN, id: 'MiniMaxAI/MiniMax-M3', nickname: 'MiniMax M3', note: 'Built for agent and tool use; reads images.', contextLength: 262144, vision: true, tools: true, thinking: 'always', cost: 4 },
  { group: GEN, id: 'Qwen/Qwen3.5-397B-A17B', nickname: 'Qwen 3.5 397B', note: 'Very large general model; strong knowledge and reasoning; reads images.', contextLength: 262144, vision: true, tools: true, thinking: 'optional', cost: 4 },
  { group: GEN, id: 'openai/gpt-oss-120b', nickname: 'GPT-OSS 120B', note: 'Reasoning and analysis; not suited to mature fiction.', contextLength: 131072, thinking: 'always', cost: 2 },
];

export function recommendedFor(baseUrl: string): RecommendedModel[] {
  if (/featherless\.ai/i.test(baseUrl)) return RECOMMENDED_FEATHERLESS;
  return [];
}
