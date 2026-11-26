// Side jobs (Helper, Proofread, suggested updates, summaries, Cliché Filter rewrites): which
// model runs each, and a queue so they never compete with the story reply. Featherless plans
// cap how many requests can run at once, so jobs wait until the story reply has finished.
import { applySplit } from '../providers/thinkSplitter';
import { contextError, fitRequest, knownLimit, learnLimit } from './fit';
import { estimateTokens } from '../context/tokens';
import { streamChat, type ProviderError, type WireMessage } from '../providers/openai';

const RETRY_WAITS = [5000, 10000, 20000, 30000];
import { RECOMMENDED_FEATHERLESS } from '../providers/recommended';
import type { Chat, Job, ModelEntry, ProviderConfig } from '../types';
import { modelFor, providerFor, useStore } from '../store/store';

export const JOB_LABEL: Record<Job, string> = {
  helper: 'Helper',
  proofread: 'Proofread',
  updates: 'Suggested updates',
  summary: 'Auto-summary',
  filter: 'Cliché Filter rewrites',
  rewrite: 'Rewrite with feedback',
  retcon: 'Retcon',
};

const STRONG = 'deepseek-ai/DeepSeek-V4-Pro-0813';
const QUICK = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const FEATHERLESS_DEFAULT: Partial<Record<Job, string>> = { helper: STRONG, proofread: STRONG, updates: QUICK, summary: QUICK, filter: QUICK, retcon: QUICK };
/** Jobs that plan or check consistency think; the rest answer directly. */
const THINKS: Record<Job, boolean> = { helper: true, proofread: true, updates: false, summary: false, filter: false, rewrite: false, retcon: false };

export interface JobModel {
  provider: ProviderConfig;
  modelId: string;
  thinking?: 'always' | 'optional';
  tools?: boolean;
  contextLength?: number;
}

/** Resolves the model for a job: the user's override, else a sensible default, else the story's model. */
export function jobModel(job: Job, chat?: Chat, o: { noOverride?: boolean; key?: string } = {}): JobModel | undefined {
  const s = useStore.getState();
  const storyModel = modelFor(chat, s);
  const storyProvider = providerFor(storyModel, s);
  const fromKey = (key?: string): JobModel | undefined => {
    if (!key) return undefined;
    // "rec:<id>": a recommended Featherless model, run on the story's Featherless connection.
    if (key.startsWith('rec:')) return storyProvider && /featherless\.ai/i.test(storyProvider.baseUrl) ? withCaps(storyProvider, key.slice(4), s.models) : undefined;
    const m = s.models.find((x) => x.key === key);
    // A model removed from "Your models" falls back to the default instead of failing.
    return m ? fromEntry(m, providerFor(m, s)) : undefined;
  };
  const override = o.noOverride ? undefined : fromKey(o.key) ?? fromKey(s.settings.jobModels?.[job]);
  if (override) return override;
  // Rewrites use the story's own model, to keep its voice.
  const def = FEATHERLESS_DEFAULT[job];
  if (def && storyProvider && /featherless\.ai/i.test(storyProvider.baseUrl)) return withCaps(storyProvider, def, s.models);
  return storyModel && storyProvider ? fromEntry(storyModel, storyProvider) : undefined;
}

/** A short name for a job's model: its nickname, else the model id without the organisation. */
export function jobModelName(job: Job, chat?: Chat, o: { noOverride?: boolean; key?: string } = {}): string | undefined {
  const m = jobModel(job, chat, o);
  if (!m) return undefined;
  const s = useStore.getState();
  return s.models.find((x) => x.providerId === m.provider.id && x.modelId === m.modelId)?.nickname || RECOMMENDED_FEATHERLESS.find((r) => r.id === m.modelId)?.nickname || m.modelId.split('/').pop();
}

/** Models a Helper can be switched to: your models, plus the recommended Featherless ones when the story runs there. */
export function pickableModels(chat?: Chat): { key: string; name: string }[] {
  const s = useStore.getState();
  const mine = s.models.map((m) => ({ key: m.key, name: m.nickname || m.modelId.split('/').pop()! }));
  const p = providerFor(modelFor(chat, s), s);
  if (!p || !/featherless\.ai/i.test(p.baseUrl)) return mine;
  const have = new Set(s.models.filter((m) => m.providerId === p.id).map((m) => m.modelId));
  return [...mine, ...RECOMMENDED_FEATHERLESS.filter((r) => !have.has(r.id)).map((r) => ({ key: `rec:${r.id}`, name: r.nickname }))];
}

function fromEntry(m: ModelEntry, p?: ProviderConfig): JobModel | undefined {
  return p ? { provider: p, modelId: m.modelId, thinking: m.thinking, tools: m.tools, contextLength: m.contextLength } : undefined;
}
function withCaps(p: ProviderConfig, modelId: string, models?: ModelEntry[]): JobModel {
  const mine = models?.find((m) => m.providerId === p.id && m.modelId === modelId);
  const rec = RECOMMENDED_FEATHERLESS.find((r) => r.id === modelId);
  return { provider: p, modelId, thinking: mine?.thinking ?? rec?.thinking, tools: mine?.tools ?? rec?.tools, contextLength: mine?.contextLength ?? rec?.contextLength };
}

export function jobThinkingExtra(job: Job, m: JobModel, think = THINKS[job]): Record<string, unknown> {
  if (!m.thinking) return {};
  if (m.thinking === 'optional')
    return think ? { chat_template_kwargs: { enable_thinking: true, thinking: true }, reasoning_effort: 'low' } : { chat_template_kwargs: { enable_thinking: false, thinking: false } };
  return { reasoning_effort: 'low' };
}

// ---------- queue ----------

let chain: Promise<unknown> = Promise.resolve();
/** The job using the provider right now, if any. */
let running: { job: Job; abort: AbortController } | undefined;
/** A story reply is about to start; jobs hold back. */
let storyWaiting = false;

/** Jobs that can be stopped for the story and simply run again after a later reply. */
const BACKGROUND: Job[] = ['updates', 'summary', 'filter'];

async function waitForStoryReply() {
  while (useStore.getState().streamingId || storyWaiting) await new Promise((r) => setTimeout(r, 300));
}

/**
 * Called before a story reply. Plans like Featherless's allow one large-model request at a time,
 * so a background job is stopped (it runs again after a later reply) and a Helper or Proofread
 * request is allowed to finish first.
 */
export async function makeRoomForStory(cancelled: () => boolean = () => false): Promise<void> {
  storyWaiting = true;
  if (running && BACKGROUND.includes(running.job)) running.abort.abort();
  while (running && !cancelled()) await new Promise((r) => setTimeout(r, 200));
}
/** The story reply has started (or failed to); jobs may queue behind it again. */
export function storyStarted() {
  storyWaiting = false;
}
export const jobRunning = () => running?.job;

export interface RunJobOptions {
  job: Job;
  /** A specific model for this run (a "Your models" key or "rec:<id>"), over the job's own. */
  modelKey?: string;
  /** Whether a model that can think first should (default: per job). */
  think?: boolean;
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
  /** Where the job is, for a progress line: sent, then thinking (with reasoning so far), then writing. */
  onProgress?: (p: JobProgress) => void;
}

export interface JobProgress {
  phase: 'sent' | 'busy' | 'thinking' | 'writing';
  /** Characters of reasoning so far. */
  reasoning: number;
}

/** No reply starting within this long (the provider queues busy models), or a stream going silent, ends the job. */
const FIRST_BYTE_MS = 6 * 60_000;
const SILENT_MS = 2 * 60_000;

export interface JobResult {
  text: string;
  reasoning: string;
}

const stoppers = new Map<string, AbortController>();
/** Stops a running side job (from the status line). What it wrote so far is dropped by its caller. */
export function stopJob(id: string) {
  stoppers.get(id)?.abort();
}

/** Runs one job after the story reply and any earlier jobs have finished. */
export function runJob(o: RunJobOptions): Promise<JobResult> {
  // Listed (and stoppable) from the moment it's asked for, while it waits its turn too.
  const id = Math.random().toString(36).slice(2);
  const abort = new AbortController();
  o.signal?.addEventListener('abort', () => abort.abort());
  stoppers.set(id, abort);
  useStore.setState({ jobs: [...useStore.getState().jobs, { id, label: o.label }] });
  const run = async (): Promise<JobResult> => {
    try {
      await waitForStoryReply();
      if (abort.signal.aborted) throw new DOMException('Stopped before it started', 'AbortError');
      const m = jobModel(o.job, o.chat, { key: o.modelKey });
      if (!m) throw new Error('Pick a model first (Settings, then Models).');
      running = { job: o.job, abort };
      return await stream(m);
    } finally {
      running = undefined;
      stoppers.delete(id);
      useStore.setState({ jobs: useStore.getState().jobs.filter((j) => j.id !== id) });
    }
  };
  const stream = async (m: JobModel): Promise<JobResult> => {
    {
      let text = '';
      let reasoning = '';
      const think = o.think ?? THINKS[o.job];
      let attempt = 0;
      // Fit prompt + reply room into the model's window; a "context too long" answer teaches us
      // the real limit (and how far off our token estimate was) for one more try.
      let scale = 1;
      let fitTries = 0;
      const extra = () => ({ ...jobThinkingExtra(o.job, m, think), ...o.extra });
      const thinkRoom = () => (m.thinking && (m.thinking === 'always' || think) ? 4096 : 0);
      let stalled = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watch = (ms: number, why: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          stalled = why;
          abort.abort();
        }, ms);
      };
      for (;;) {
        const step = new AbortController();
        const cut = () => step.abort();
        abort.signal.addEventListener('abort', cut);
        try {
          o.onProgress?.({ phase: 'sent', reasoning: reasoning.length });
          watch(FIRST_BYTE_MS, `${m.provider.name} didn't start the reply within ${FIRST_BYTE_MS / 60_000} minutes (the model may be busy). Try again in a moment.`);
          const fit = fitRequest(o.messages, (o.maxTokens ?? 2048) + thinkRoom(), knownLimit(m.modelId, m.contextLength), scale);
          if (fit.maxOut < 1024) throw new Error(`This is too long for ${m.modelId.split('/').pop()}'s ${knownLimit(m.modelId, m.contextLength)?.toLocaleString()}-token window on your plan, even without the earlier conversation. Pick a model with a bigger window, or shorten the story's setup or Codex.`);
          for await (const ev of streamChat(m.provider, m.modelId, fit.messages, { maxTokens: fit.maxOut, temperature: o.temperature ?? 0.5 }, step.signal, extra(), !!thinkRoom())) {
            watch(SILENT_MS, `The reply stopped arriving for ${SILENT_MS / 60_000} minutes, so it was ended. Try again.`);
            if (ev.type === 'moved') {
              ({ content: text, reasoning } = applySplit({ content: text, reasoning }, { content: '', reasoning: '', moved: ev }));
              o.onText?.(text);
            } else if (ev.type === 'content') {
              text += ev.text;
              o.onText?.(text);
              o.onProgress?.({ phase: 'writing', reasoning: reasoning.length });
            } else if (ev.type === 'reasoning') {
              reasoning += ev.text;
              o.onProgress?.({ phase: 'thinking', reasoning: reasoning.length });
            }
          }
          clearTimeout(timer);
          return { text: text.trim(), reasoning };
        } catch (e) {
          clearTimeout(timer);
          if (stalled) throw new Error(stalled);
          const ce = !text && !abort.signal.aborted ? contextError((e as Error).message ?? '') : undefined;
          if (ce && fitTries++ < 2) {
            learnLimit(m.modelId, ce.limit);
            const sent = fitRequest(o.messages, (o.maxTokens ?? 2048) + thinkRoom(), knownLimit(m.modelId, m.contextLength), scale).messages;
            const est = sent.reduce((n, x) => n + estimateTokens(typeof x.content === 'string' ? x.content : JSON.stringify(x.content)) + 4, 0);
            scale = ce.prompt && est ? Math.max(scale, ce.prompt / est) * 1.03 : scale * 1.15;
            continue;
          }
          // Busy (another request is using the plan's allowance) or a dropped connection: wait and retry.
          const busy = (e as ProviderError).status === 429 || e instanceof TypeError;
          if (!busy || text || attempt >= RETRY_WAITS.length || abort.signal.aborted) throw e;
          running = undefined;
          o.onProgress?.({ phase: 'busy', reasoning: reasoning.length });
          await new Promise((r) => setTimeout(r, RETRY_WAITS[attempt++]));
          await waitForStoryReply();
          running = { job: o.job, abort };
        } finally {
          abort.signal.removeEventListener('abort', cut);
        }
      }
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
