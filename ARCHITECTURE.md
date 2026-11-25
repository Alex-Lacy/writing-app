# Architecture

Single-page React + TypeScript app built with Vite. No backend: the browser calls the provider
directly (Featherless sends CORS headers), and all data lives in IndexedDB on the device.

```
src/
  types.ts               data model: Chat, Message (with swipes), Codex, Suggestion, Style modules, settings
  db/db.ts               IndexedDB (idb) with numbered MIGRATIONS; export/import (keys excluded)
  providers/openai.ts    OpenAI-compatible client: listModels, streamChat (SSE), friendly errors
  providers/thinkSplitter.ts   splits inline <think> blocks out of streamed text
  context/build.ts       context pipeline: ContextBlocks + history -> messages within the token budget
  context/codex.ts       Codex triggers, and the blocks for Global notes, Style modules, Story tags, summary
  context/tokens.ts      token estimate, calibrated from the provider's real usage numbers
  ai/jobs.ts             side jobs (Helper, updates, summary, Proofread, rewrites, Cliché Filter):
                         one at a time, per-job models, retries on 429, always yield to the story reply
  store/store.ts         zustand store and core actions (send, generate, swipe, edit, delete), reply hooks
  store/suggestions.ts   suggestion cards: accept / edit / reject / undo for every kind of change
  store/codexStore.ts    Codex books: each story's own book, shared books in the Library
  features/              helper, updates, summary, rewrite (Rewrite + Proofread), compile (Export),
                         filter/ (Cliché Filter rules, scanning, fixes), starters (built-in Helpers, Style modules)
  components/            UI; components/panel/ is the Story panel (Setup, Codex, Helper, Cliché Filter, Suggestions)
```

## Key decisions

- **Messages hold swipes.** Each message has `swipes[]` + `activeSwipe`; only the active one is sent.
- **Context is a pipeline of blocks.** Everything injected is a `ContextBlock` with a placement: `top`
  (one leading system message, ordered: Global notes 5, Background 10, Style modules 12, Story tags 15,
  Codex 20, Story so far 30), `depth` (Steering, N messages from the end, as a system message or inline) or
  `tail` (Length). History is fitted newest-first; the builder reports what it dropped.
- **Every AI change is a card.** The Helper, suggested updates, auto-summary, Proofread, Rewrite and the
  Cliché Filter all produce `Suggestion`s with before/after. Nothing changes the story or notes until the
  person accepts (Cliché Filter Auto mode and later summary parts accept themselves, and stay undoable).
  Passage cards store offsets; accepting one shifts the others in the same message, and a card whose text
  was edited meanwhile says so instead of guessing.
- **The Helper speaks a text protocol**, not native tool calls: its reply ends with a ```changes JSON block.
  Works with any model, has no step limit, and every change is reviewable.
- **Side jobs never block the story.** Background jobs (updates, summary, filter) are stopped when a reply
  starts; Helper/Proofread/Rewrite are allowed to finish first ("Waiting for…" in the composer). This matters
  on Featherless, where one large model uses the whole concurrency allowance.
- **Rewrites see the story around the passage** (before/after text, setup, triggered Codex, summary of
  earlier parts), even for parts already summarised: originals are never deleted.
- **After-reply hooks** (`replyHooks`): suggested updates (every ~1,500 new words by default), auto-summary
  (at 85% of the context), Cliché Filter (Suggest/Auto modes).

## Phase 3 plan

Image attachments for vision models, web search for the Helper, service worker for offline install, and sync
(every record already has an id and timestamps).
