// Curated one-click models per provider. Featherless IDs and context sizes were checked against
// its live /models list (Nov 2026). Gated models (needing a Hugging Face approval) are left out.
// Bigger models need a Featherless plan that includes them.

export interface RecommendedModel {
  id: string;
  nickname: string;
  group: string;
  note: string;
  contextLength?: number;
  vision?: boolean;
}

const C70 = 'Creative writing: large (70B)';
const C24 = 'Creative writing: medium (24B)';
const C12 = 'Creative writing: small and fast (12B)';
const GEN = 'General purpose and reasoning';

const FEATHERLESS: RecommendedModel[] = [
  { group: C70, id: 'Sao10K/L3.3-70B-Euryale-v2.3', nickname: 'Euryale 70B', note: 'Rich, descriptive prose; a long-standing roleplay and story favourite.', contextLength: 32768 },
  { group: C70, id: 'Steelskull/L3.3-MS-Nevoria-70b', nickname: 'Nevoria 70B', note: 'Creative merge with vivid, varied writing.', contextLength: 32768 },
  { group: C70, id: 'TheDrummer/Anubis-70B-v1', nickname: 'Anubis 70B', note: 'Strong character voice and dialogue.', contextLength: 32768 },
  { group: C70, id: 'LatitudeGames/Wayfarer-Large-70B-Llama-3.3', nickname: 'Wayfarer 70B', note: 'Adventure fiction; lets things go wrong instead of always being nice.', contextLength: 32768 },
  { group: C70, id: 'zerofata/L3.3-GeneticLemonade-Unleashed-v3-70B', nickname: 'Lemonade 70B', note: 'Uncensored creative merge, energetic prose.', contextLength: 32768 },

  { group: C24, id: 'TheDrummer/Cydonia-24B-v4.1', nickname: 'Cydonia 24B', note: 'Popular all-rounder for stories and roleplay.', contextLength: 32768 },
  { group: C24, id: 'PocketDoc/Dans-PersonalityEngine-V1.3.0-24b', nickname: 'PersonalityEngine 24B', note: 'Versatile; good at following style instructions.', contextLength: 32768 },
  { group: C24, id: 'Doctor-Shotgun/MS3.2-24B-Magnum-Diamond', nickname: 'Magnum Diamond 24B', note: 'Literary, Claude-like prose style.', contextLength: 32768 },
  { group: C24, id: 'Delta-Vector/Austral-24B-Winton', nickname: 'Austral 24B', note: 'Adventure and long-form story focus.', contextLength: 32768 },

  { group: C12, id: 'inflatebot/MN-12B-Mag-Mell-R1', nickname: 'Mag Mell 12B', note: 'Best-loved small creative model; imaginative.', contextLength: 32768 },
  { group: C12, id: 'TheDrummer/Rocinante-12B-v1.1', nickname: 'Rocinante 12B', note: 'Vivid storytelling, very willing.', contextLength: 32768 },
  { group: C12, id: 'LatitudeGames/Muse-12B', nickname: 'Muse 12B', note: 'Long-form narrative with emotional depth.', contextLength: 32768 },
  { group: C12, id: 'nothingiisreal/MN-12B-Celeste-V1.9', nickname: 'Celeste 12B', note: 'Natural, human-sounding prose.', contextLength: 32768 },

  { group: GEN, id: 'deepseek-ai/DeepSeek-V3.2', nickname: 'DeepSeek V3.2', note: 'Very capable general model; good writer too.', contextLength: 131072 },
  { group: GEN, id: 'zai-org/GLM-4.7', nickname: 'GLM 4.7', note: 'Large, smart general model with strong creative writing.', contextLength: 202752 },
  { group: GEN, id: 'moonshotai/Kimi-K2.5', nickname: 'Kimi K2.5', note: 'Large general model, distinctive prose voice.', contextLength: 262144 },
  { group: GEN, id: 'Qwen/Qwen3.8-27B', nickname: 'Qwen 3.8 27B', note: 'Fast all-rounder; can read images.', contextLength: 262144, vision: true },
  { group: GEN, id: 'deepseek-ai/DeepSeek-R1-0528', nickname: 'DeepSeek R1', note: 'Reasoning model: thinks first (shown collapsed).', contextLength: 131072 },
  { group: GEN, id: 'mistralai/Mistral-Nemo-Instruct-2407', nickname: 'Mistral Nemo 12B', note: 'Small, quick, cheap general assistant.', contextLength: 32768 },
];

export function recommendedFor(baseUrl: string): RecommendedModel[] {
  if (/featherless\.ai/i.test(baseUrl)) return FEATHERLESS;
  return [];
}
