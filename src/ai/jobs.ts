// Side jobs (Helper, Proofread, suggested updates, summaries, Cliché Filter rewrites): which
// model runs each, and a queue so they never compete with the story reply. Featherless plans
// cap how many requests can run at once, so jobs wait until the story reply has finished.
import { streamChat, type WireMessage } from '../providers/openai';
import { RECOMMENDED_FEATHERLESS } from '../providers/recommended';
import type { Chat, Job, ModelEntry, ProviderConfig } from '../types';
import { modelFor, providerFor, useStore } from '../store/store';

export const JOB_LABEL: Record<Job, string> = {
  helper: 'Helper',
  proofread: 'Proofread',
  updates: 'Suggested updates',
  summary: 'Auto-summary',
  filter: 'Cliché Filter rewrites',
};

const STRONG = 'deepseek-ai/DeepSeek-V4-Pro-0813';
const QUICK = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const FEATHERLESS_DEFAULT: Record<Job, string> = { helper: STRONG, proofread: STRONG, updates: QUICK, summary: QUICK, filter: QUICK };
/** Jobs that plan or check consistency think; the rest answer directly. */
const THINKS: Record<Job, boolean> = { helper: true, proofread: true, updates: false, summary: false, filter: false };

export interface JobModel {
  provider: ProviderConfig;
  modelId: string;
  thinking?: 'always' | 'optional';
  tools?: boolean;
  contextLength?: number;
}

/** Resolves the model for a job: the user's override, else a sensible default, else the story's model. */
export function jobModel(job: Job, chat?: Chat): JobModel | undefined {
  const s = useStore.getState();
  const storyModel = modelFor(chat, s);
  const storyProvider = providerFor(storyModel, s);
  const fromKey = (key?: string): JobModel | undefined => {
    if (!key) return undefined;
    const m = s.models.find((x) => x.key === key);
    if (m) return fromEntry(m, providerFor(m, s));
    const [pid, ...rest] = key.split('::');
    const p = s.providers.find((x) => x.id === pid);
    return p ? withCaps(p, rest.join('::'), undefined) : undefined;
  };
  const override = fromKey(s.settings.jobModels?.[job]);
  if (override) return override;
  if (storyProvider && /featherless\.ai/i.test(storyProvider.baseUrl)) return withCaps(storyProvider, FEATHERLESS_DEFAULT[job], s.models);
  return storyModel && storyProvider ? fromEntry(storyModel, storyProvider) : undefined;
}

function fromEntry(m: ModelEntry, p?: ProviderConfig): JobModel | undefined {
  return p ? { provider: p, modelId: m.modelId, thinking: m.thinking, tools: m.tools, contextLength: m.contextLength } : undefined;
}
function withCaps(p: ProviderConfig, modelId: string, models?: ModelEntry[]): JobModel {
  const mine = models?.find((m) => m.providerId === p.id && m.modelId === modelId);
  const rec = RECOMMENDED_FEATHERLESS.find((r) => r.id === modelId);
  return { provider: p, modelId, thinking: mine?.thinking ?? rec?.thinking, tools: mine?.tools ?? rec?.tools, contextLength: mine?.contextLength ?? rec?.contextLength };
}

export function jobThinkingExtra(job: Job, m: JobModel): Record<string, unknown> {
  if (!m.thinking) return {};
  if (m.thinking === 'optional')
    return THINKS[job] ? { chat_template_kwargs: { enable_thinking: true, thinking: true }, reasoning_effort: 'low' } : { chat_template_kwargs: { enable_thinking: false, thinking: false } };
  return { reasoning_effort: 'low' };
}

// ---------- queue ----------

let chain: Promise<unknown> = Promise.resolve();

async function waitForStoryReply() {
  while (useStore.getState().streamingId) await new Promise((r) => setTimeout(r, 300));
}

export interface RunJobOptions {
  job: Job;
  chat?: Chat;
  messages: WireMessage[];
  /** Shown in the status line while it runs. */
  label: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  extra?: Record<string, unknown>;
  /** Live text, for jobs shown as they stream (the Helper). */
  onText?: (text: string) => void;
}

export interface JobResult {
  text: string;
  reasoning: string;
}

/** Runs one job after the story reply and any earlier jobs have finished. */
export function runJob(o: RunJobOptions): Promise<JobResult> {
  const run = async (): Promise<JobResult> => {
    await waitForStoryReply();
    const m = jobModel(o.job, o.chat);
    if (!m) throw new Error('Pick a model first (Settings, then Models).');
    const id = Math.random().toString(36).slice(2);
    useStore.setState({ jobs: [...useStore.getState().jobs, { id, label: o.label }] });
    try {
      let text = '';
      let reasoning = '';
      const extra = { ...jobThinkingExtra(o.job, m), ...o.extra };
      const thinkRoom = m.thinking && (m.thinking === 'always' || THINKS[o.job]) ? 4096 : 0;
      for await (const ev of streamChat(m.provider, m.modelId, o.messages, { maxTokens: (o.maxTokens ?? 2048) + thinkRoom, temperature: o.temperature ?? 0.5 }, o.signal, extra)) {
        if (ev.type === 'content') {
          text += ev.text;
          o.onText?.(text);
        } else if (ev.type === 'reasoning') reasoning += ev.text;
      }
      return { text: text.trim(), reasoning };
    } finally {
      useStore.setState({ jobs: useStore.getState().jobs.filter((j) => j.id !== id) });
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** Pulls the first JSON value out of a model reply (fenced or bare). */
export function parseJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const open = c[start];
    const close = open === '{' ? '}' : ']';
    const end = c.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      /* try the next */
    }
  }
  return undefined;
}
