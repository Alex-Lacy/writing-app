# Architecture

Single-page React + TypeScript app built with Vite. No backend: the browser calls the provider
directly (Featherless sends CORS headers, verified from a browser), and all data lives in IndexedDB.

```
src/
  types.ts               data model (Chat, Message with swipes, ModelEntry, ProviderConfig, settings)
  db/db.ts               IndexedDB (idb): kv, providers, models, presets, chats, messages; export/import
  providers/openai.ts    generic OpenAI-compatible client: listModels (paginated), streamChat (SSE), complete()
  providers/thinkSplitter.ts   splits inline <think> blocks out of streamed content
  context/build.ts       context pipeline: ContextBlocks + history -> messages within the token budget
  context/tokens.ts      token estimate (pluggable; swap for a real tokenizer later)
  store/store.ts         zustand store + all actions (send, generate, swipe, edit, delete...)
  components/            UI
  tools/                 Phase 2+ tools (each self-contained)
```

## Key decisions

- **Messages hold swipes.** Each message has `swipes[]` + `activeSwipe`. Retry on an assistant message adds a
  swipe; Retry on a user message adds a swipe to the reply after it. Only the active swipe goes into context.
- **Context is a pipeline of blocks.** Anything injected (Memory, Author's Note, later lorebook entries, the
  condensed summary, search results) is a `ContextBlock` with a placement: `top` (merged into the single
  leading system message, ordered) or `depth` (N messages from the end, as a system message or inline).
  History is fitted newest-first under `contextLimit - maxTokens - safetyMargin`. The builder returns what it
  dropped, which drives the "out of context" greying and will trigger auto-condense.
- **Author's Note "inline" mode** exists because some chat templates (Gemma, strict Mistral) reject a system
  message mid-conversation or require strict user/assistant alternation.
- **Provider-agnostic.** Optional sampler params are only sent when set. Unknown fields from `/models`
  (context_length, features.image_input) are read when present.

## Phase 2 plan

- **Lorebook** (`tools/lorebook/`): new `lorebooks` + `loreEntries` stores (keys, regex flag, content,
  insertion order/depth, always-on, enabled). Contributor scans the last N messages for keys and returns
  blocks with `top` or `depth` placement. Chat gets `writing.lorebookIds`. Proposed updates: a `complete()`
  call that returns JSON diffs, shown as accept/reject cards.
- **Auto-condense** (`tools/condense/`): when `buildContext` reports dropped messages (or usage > ~85%),
  summarise the oldest un-condensed span with `complete()`, store it on `chat.summary`, mark those messages
  `condensed`, and inject the summary as a `top` block after Memory. Reversible (un-condense).
- **Compile** (`tools/compile/`): pick messages (default: assistant swipes), strip OOC/instructions with a
  model pass, add chapter headings, optional proofread pass, export Markdown/DOCX.
- **Slop Slayer** (`tools/slopSlayer/`): port of the NAI script v1.1.6.
  - `rules.ts`: parse the rule format (`#! [id] description` line, then `/regex/flags`) and word lists
    (`NAME== a|b|c`, nested `%NAME%` expansion), compile, report failures. Ship the script's DEFAULT_RULES and
    DEFAULT_WORDLISTS; user rules add to them; rules can be disabled by id.
  - `scan.ts`: run rules over a message, return spans `{ruleId, from, to}`; sentence expansion for rewrites.
  - Modes per chat: Manual / Highlight (scan after each generation, mark spans in MessageItem) / Supervised
    (propose replacements in a review list) / Auto (rewrite up to a limit). AI rewrite uses `complete()` with
    the surrounding sentence as context. Per-rule hit stats.
  - Hook: `generate()` gets a post-generation hook list; Slop Slayer registers one. MessageItem gets a
    decorator pass for highlights.

## Phase 3 plan

Image/file attachments (`Message.attachments`, sent as `image_url` parts for models with `vision`), web search
tool (Tavily/Brave/SearXNG key in settings, exposed as a narrow tool alongside lorebook/memory read/update),
service worker for offline install, and sync (every record already has an id and timestamps; candidates are a
small sync server, or a file in the user's cloud drive).
