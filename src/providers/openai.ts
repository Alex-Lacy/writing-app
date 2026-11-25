import type { GenParams, ProviderConfig } from '../types';
import { ThinkSplitter } from './thinkSplitter';

// Generic OpenAI-compatible client (Featherless, OpenRouter, local llama.cpp/Ollama, OpenAI itself...).
// Nothing in here is Featherless-specific beyond reading optional fields from /models.

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface RemoteModel {
  id: string;
  contextLength?: number;
  description?: string;
  vision?: boolean;
  tools?: boolean;
  /** Featherless: how many concurrency units one request uses (1 small, 2 medium, 4 large). */
  cost?: number;
}

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; finishReason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function headers(p: ProviderConfig): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  return h;
}

const base = (p: ProviderConfig) => p.baseUrl.replace(/\/+$/, '');

async function errorFrom(res: Response): Promise<ProviderError> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      msg = j.error?.message ?? j.message ?? j.detail ?? t ?? msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch {
      if (t) msg = `${res.status}: ${t.slice(0, 500)}`;
    }
  } catch {
    /* ignore */
  }
  return new ProviderError(msg, res.status);
}

function mapModel(m: any): RemoteModel {
  return {
    id: String(m.id),
    contextLength: m.context_length ?? m.max_context_length ?? m.context_window ?? undefined,
    description: m.model_class ?? m.description ?? undefined,
    vision: m.features?.image_input ?? m.architecture?.input_modalities?.includes?.('image') ?? undefined,
    tools: m.features?.tool_use ?? (Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : undefined),
    cost: typeof m.concurrency_cost === 'number' ? m.concurrency_cost : undefined,
  };
}

async function fetchModelPage(p: ProviderConfig, query: string, signal?: AbortSignal): Promise<any[]> {
  const res = await fetch(`${base(p)}/models${query}`, { headers: headers(p), signal });
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json();
  return Array.isArray(j) ? j : (j.data ?? []);
}

export const PAGE_SIZE = 1000;

/**
 * Lists one page of models. Featherless paginates /models (50 by default), so we ask for big
 * pages; providers that ignore the params just return everything. Fetch one page at a time so
 * we never burst requests (Featherless rate-limits, and a 429 arrives without CORS headers,
 * which the browser reports as a bare network error).
 */
export async function listModelsPage(p: ProviderConfig, page: number, signal?: AbortSignal): Promise<RemoteModel[]> {
  const rows = await fetchModelPage(p, `?per_page=${PAGE_SIZE}&page=${page}`, signal).catch(async (e) => {
    // Some servers reject unknown query params; fall back to the plain endpoint on page 1.
    if (page === 1 && e instanceof ProviderError) return fetchModelPage(p, '', signal);
    throw e;
  });
  return rows.map(mapModel);
}

/** Turns fetch's opaque network errors into something actionable. */
export function friendlyError(e: unknown, providerName = 'the provider'): string {
  const msg = (e as Error)?.message || String(e);
  if (e instanceof TypeError || /NetworkError|Failed to fetch|Load failed/i.test(msg))
    return `Couldn't reach ${providerName}. Most often this is a temporary rate limit (wait a minute and try again); otherwise check your internet connection and the base URL.`;
  if ((e as ProviderError)?.status === 429) return `${providerName} is rate-limiting requests. Wait a minute and try again.`;
  if ((e as ProviderError)?.status === 401) return `${providerName} rejected the API key (401). Check the key in Settings → Providers.`;
  return msg;
}

export function buildBody(model: string, messages: WireMessage[], params: GenParams, stream: boolean) {
  const body: Record<string, unknown> = { model, messages, stream, max_tokens: params.maxTokens };
  const opt: [keyof GenParams, string][] = [
    ['temperature', 'temperature'],
    ['topP', 'top_p'],
    ['minP', 'min_p'],
    ['topK', 'top_k'],
    ['repetitionPenalty', 'repetition_penalty'],
    ['frequencyPenalty', 'frequency_penalty'],
    ['presencePenalty', 'presence_penalty'],
  ];
  for (const [k, wire] of opt) {
    const v = params[k];
    if (v !== undefined && v !== null && !Number.isNaN(v)) body[wire] = v;
  }
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

/** Streams a chat completion. Yields content and reasoning deltas, then a final 'done'. */
export async function* streamChat(
  p: ProviderConfig,
  model: string,
  messages: WireMessage[],
  params: GenParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${base(p)}/chat/completions`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify(buildBody(model, messages, params, true)),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new ProviderError('No response body');

  // Some providers ignore stream:true for some models and return plain JSON.
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) {
    const j = await res.json();
    const msg = j.choices?.[0]?.message ?? {};
    const split = new ThinkSplitter();
    const a = split.push(msg.content ?? '');
    const b = split.flush();
    const reasoning = (msg.reasoning_content ?? msg.reasoning ?? '') + a.reasoning + b.reasoning;
    if (reasoning) yield { type: 'reasoning', text: reasoning };
    yield { type: 'content', text: a.content + b.content };
    yield { type: 'done', finishReason: j.choices?.[0]?.finish_reason, usage: j.usage };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const split = new ThinkSplitter();
  let buf = '';
  let finishReason: string | undefined;
  let usage: any;

  const handle = function* (data: string): Generator<StreamEvent> {
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.error) throw new ProviderError(j.error.message ?? JSON.stringify(j.error));
    if (j.usage) usage = j.usage;
    const ch = j.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) finishReason = ch.finish_reason;
    const d = ch.delta ?? ch.message ?? {};
    const r = d.reasoning_content ?? d.reasoning;
    if (r) yield { type: 'reasoning', text: r };
    const c = d.content ?? ch.text;
    if (c) {
      const out = split.push(c);
      if (out.reasoning) yield { type: 'reasoning', text: out.reasoning };
      if (out.content) yield { type: 'content', text: out.content };
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      yield* handle(data);
    }
  }
  if (buf.startsWith('data:')) {
    const data = buf.slice(5).trim();
    if (data && data !== '[DONE]') yield* handle(data);
  }
  const rest = split.flush();
  if (rest.reasoning) yield { type: 'reasoning', text: rest.reasoning };
  if (rest.content) yield { type: 'content', text: rest.content };
  yield { type: 'done', finishReason, usage };
}

/** Non-streaming helper for tool-style calls (titles now; condense/compile/Slop Slayer rewrites in Phase 2). */
export async function complete(
  p: ProviderConfig,
  model: string,
  messages: WireMessage[],
  params: GenParams,
  signal?: AbortSignal,
): Promise<string> {
  let out = '';
  for await (const ev of streamChat(p, model, messages, params, signal)) if (ev.type === 'content') out += ev.text;
  return out.trim();
}
