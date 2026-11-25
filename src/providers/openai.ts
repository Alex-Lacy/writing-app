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
  };
}

async function fetchModelPage(p: ProviderConfig, query: string, signal?: AbortSignal): Promise<any[]> {
  const res = await fetch(`${base(p)}/models${query}`, { headers: headers(p), signal });
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json();
  return Array.isArray(j) ? j : (j.data ?? []);
}

/**
 * Lists models. Some providers (Featherless) paginate /models; we ask for large pages and keep
 * going while new ids appear. Providers that ignore the query params just return the same list,
 * which stops the loop after one extra request.
 */
export async function listModels(p: ProviderConfig, signal?: AbortSignal): Promise<RemoteModel[]> {
  const byId = new Map<string, RemoteModel>();
  for (const m of await fetchModelPage(p, '', signal)) byId.set(String(m.id), mapModel(m));
  for (let page = 1; page <= 40; page++) {
    let batch: any[];
    try {
      batch = await fetchModelPage(p, `?per_page=1000&page=${page}`, signal);
    } catch {
      break;
    }
    let added = 0;
    for (const m of batch) if (!byId.has(String(m.id))) { byId.set(String(m.id), mapModel(m)); added++; }
    if (added === 0 || batch.length < 1000) break;
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
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
